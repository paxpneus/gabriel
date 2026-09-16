# Tecinco API auth/session

`src/modules/handlers/tecinco/api/tecinco_api.ts`

- `sessionPool` (a `Map<branchId, TCarBranchSession>`) caches one session token per branch, in memory only — lost on every process restart. Both `ensureSession` (cache-miss login) and `onResponseError`'s 401 handler (session-expired relogin) call `doTCarLogin(branchId)`, and each already serializes concurrent calls *for the same branch* via the branch's own `isRefreshing`/`failedQueue`.
- **Fixed — intermittent 403 on `/auth/login`**: `doTCarLogin` uses the *same* account credentials (username/password/api_key/company_id) for every branch — only the later `/auth/session/branch` call differs by branch. The per-branch lock above doesn't stop two *different* branches from calling `/auth/login` at the same time (e.g. `TCarSyncQueue` dispatches one job per branch — currently branches `12`/`17` — both can run concurrently right after a process restart or whenever both branches' cached tokens are empty at once). Tecinco's API rejects one of two concurrent logins for the same account with a bare 403 (not 401/429, so neither existing retry path in the response interceptor catches it) — matched the observed pattern of ~3% of requests failing with a plain "Request failed with status code 403" bottoming out in `doTCarLogin`. **Fixed** by wrapping `doTCarLogin`'s entire body in a **module-level** (not per-branch) promise-chain mutex (`withTCarLoginLock`), so logins for different branches queue up instead of racing — covers both call sites (`ensureSession`, the 401 relogin path) since both go through `doTCarLogin`.
- **`TCAR_UPSERT`/`TCAR_SYNC` deliberately do NOT share a BullMQ
  `sharedLock`** (unlike Bling's queues, which share
  `BLING_SHARED_QUEUE_LOCK` — see `.claude/modules/ml-order-pipeline/locks.md`
  and `bling-queue-lock.ts`). This was considered and rejected:
  `TCarSyncQueue.process` (`tecinco-sync-queue.ts`) calls `runMigration`
  (`tecinco-migration.runner.ts`), which enqueues jobs onto `TCAR_UPSERT`
  and then blocks on `waitForQueueToDrain(upsertQueue, ...)` as part of the
  *same* sync job. A full job-level `sharedLock` between the two queues
  would deadlock: the sync job holds the lock while waiting for
  `TCAR_UPSERT` to drain, but `TCAR_UPSERT` jobs can never acquire that
  same lock to run and drain. The module-level login mutex above already
  serializes the actual race (concurrent `/auth/login` calls) without this
  risk, since both queues funnel through the same `doTCarLogin`. If queue-level
  coordination between `TCAR_UPSERT`/`TCAR_SYNC` is wanted later, it needs
  a narrower lock scoped to the individual Tecinco API calls inside
  `migrateProdutos`/`migrateClientes`/`migrateNotasFiscais`, not the whole
  job — the `waitForQueueToDrain` step must stay outside any such lock.
