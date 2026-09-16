# Store entity

`src/modules/sales/stores/`

- `Store` is **not** one row per physical branch — a small, fixed taxonomy of Bling sales-channel *types* (`tipo` from Bling's `/canais-venda/{id}`, e.g. `"LojaFisica"`, `"MercadoLivre"`), shared by every branch/channel of that type. `name` (the `tipo` value) is the real identity the rest of the codebase keys off directly — `nfe-reconciler.queue.ts`'s `where: { name: "MercadoLivre" }`, `ALLOWED_STORE_NAME` (`nfe.queue.ts`/`cnpj.queue.ts`), the `where: { name: "Outros" }` fallback in `bling-api-fetch.queue.ts`/`invoice-xml.ts`, and `Integration.allowed_channels`. `id_store_system` is only a fast-lookup cache for one specific Bling channel id already known to resolve to that bucket — not a real per-row identity, not unique.

## Fixed — ~20 duplicate `Store` rows all named `"LojaFisica"` in production

Root cause: `BlingOrderService` (`createOrderFromBling`/`updateOrderFromBling`, identical code duplicated in each) resolved the channel's `Store` via a plain check-then-create (`findOne({where:{name: tipo}})` then `create(...)`) with **no DB unique constraint on `name`** — under concurrent webhook processing for orders from different physical branches sharing the same Bling `tipo`, multiple requests could all pass the `findOne` check before any committed, each creating its own row.

**Fixed**: both call sites go through one shared private `BlingOrderService.resolveStore(lojaId)` → `storeService.findOrCreateByName(tipo, idStoreSystem)` → `StoreRepository.findOrCreateByName` uses Sequelize's `findOrCreate` on `name`, race-safe via a new unique index (`m276-dedupe-stores-and-unique-name.js`).

That migration also merges the pre-existing duplicates: picks the oldest row per `name` as canonical, reassigns `orders.store_id`/`invoices.store_id`/`sales_order_snapshots.store_id`/`sales_order_item_snapshots.store_id` from the duplicates to it (plain UPDATE — none of those tables has a unique constraint on `store_id`). `daily_sales_store_facts` has `UNIQUE(fact_date, unit_business_id, store_id)` and its metric columns include percentages (`markup_pct`/`contribution_pct`) that can't be arithmetically merged — so duplicate-pinned fact rows are just deleted instead of reassigned, since that table is a derived snapshot (`upsertDailySalesStoreFacts`) that regenerates from `orders`/`sales_order_snapshots`, which this same migration already fixed. **Does not retroactively recompute** historical daily-sales-store facts already recorded under the wrong `store_id` — rerun the snapshot/fact recompute after the migration if exact historical reporting matters.

As always, **the user runs this migration themselves.**
