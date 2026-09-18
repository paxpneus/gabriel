# IntegrationError

Tabela genérica de falhas de integração, `integration_errors` (`src/modules/integrations/integration-errors/`). Cobre qualquer módulo/integração cuja falha hoje não tem nenhum lugar estruturado pra ficar visível (só `console.*`) — diferente de `unmapped_invoice_products`, que é específico pra mapeamento de produto.

## Schema

- `entity`: STRING(50), não é ENUM de banco — validado no lado app pelo enum TS `IntegrationErrorEntity` (`integration-error.types.ts`), pra permitir instrumentar entidade nova sem migration. Valores usados até agora: `CTE`.
- `type`: STRING(100) — código/categoria do erro, definido por quem chama (ex.: string do `codigo_retorno` da Datafrete, `"SIEG_FETCH_FAILED"`, `"CTE_UPSERT_FAILED"`, `"UNKNOWN"`).
- `integrations_id`: FK obrigatória pra `integrations.id` — sempre resolvida pelo caller via o padrão já existente (`getSiegIntegration()`, `getDatafreteIntegration()`, etc.), nunca hardcoded.
- `external_id`: id da entidade **na integração externa** (ex.: `produtoId` no Bling), nulo quando a integração não expõe id pra essa entidade — hoje sempre nulo pra CT-e, já que Datafrete/Sieg identificam CT-e por chave/número, não por id (ver `reference`).
- `internal_id`: id da entidade **no nosso próprio sistema** (ex.: `cte.id`), quando resolvível — nulo quando a falha acontece antes de existir uma entidade local (ex.: falha no fetch do Sieg antes de qualquer CT-e ser upsertado).
- `reference`: texto legível pra localizar a entidade (chave/número do CT-e, ou um `logLabel` descritivo quando não há entidade ainda).
- `message`: descrição legível do erro.
- `resolved`/`resolved_at`: workflow manual de revisão — marcado via `PUT /integration-errors/:id/resolve`.
- `event_id`: FK nula pra `events.id` — guarda o evento (`EventService`) disparado pra usuários `developer` na primeira ocorrência dessa combinação de dedup. Ver "Notificação" abaixo.
- `occurrences`/`last_seen_at`: contador de repetição do mesmo erro — ver upsert-by-find abaixo.

## Dedup via upsert-by-find (`IntegrationErrorService.recordError`)

Chave de dedup: `(entity, type, integrations_id, internal_id, external_id)` (índice único `uq_integration_errors_dedup`, migration `m282`, com `COALESCE` pra cada um dos dois ids poder ser nulo). Reusa `BaseRepository.upsertByFind` — não achou a combinação, cria a linha (`occurrences: 1`); achou, soma `occurrences` (via `Sequelize.literal`) e **reabre** (`resolved: false, resolved_at: null`) mesmo que já estivesse marcada resolvida — reincidência depois de "resolvido" significa que o problema voltou.

## Notificação a usuários `developer` (`EventService.notifyByRoles`)

`recordError` faz um `findOne` pela chave de dedup **antes** do `upsertByFind` pra saber se a linha é nova. Só chama `eventService.notifyByRoles({ types: [DEVELOPER_USER_TYPE] })` (sem `unitBusinessId` — erro de integração é evento de sistema, não de uma loja específica, então notifica usuários `developer` de todas as unit businesses) quando a linha encontrada **não tem `event_id` ainda** (linha nova, ou uma ocorrência anterior que não conseguiu criar o evento, ex.: nenhum usuário `developer` cadastrado naquele momento). Achou a linha já com `event_id` preenchido: só soma `occurrences`, não notifica de novo — reincidência do mesmo erro não gera evento repetido. O `event_id` retornado é persistido na própria linha logo em seguida.

`UserType` "developer" (`user_config.type`, `USER_TYPES`/`DEVELOPER_USER_TYPE` em `shared/constants/user-types.ts`) tem `modules: "*"`, igual `admin` — mesmo acesso total ao sistema. Notificação de nota fiscal entrando (`invoice.service.ts`, `notifyByRoles({ types: ["operator", "admin"] })`) continua não incluindo `developer` — é lista explícita, não teve troca pra "todos exceto developer".

## Logger centralizado (`IntegrationLoggerService.log`)

Ponto único de entrada que todo módulo chama pra reportar evento de integração (`integration-logger.service.ts`) — não é um `BaseService`/entidade, é uma fachada cross-cutting. Recebe a flag `createIntegrationError`:
- `true`: falha real/final — persiste via `IntegrationErrorService.recordError`.
- `false`: aviso transiente (ex.: tentativa de retry ainda em andamento, pode dar certo na próxima) — não persiste hoje. Reservado pro ponto onde futuramente entra `pino.warn`/`error` incondicional (antes da checagem da flag), sem precisar tocar de novo nos call sites já instrumentados.

## Call sites instrumentados

- `sync-datafrete-cte.service.ts`, catch de `syncPendingCtes` (caminho batch) — `entity: CTE`, `type` = `codigo_retorno` da Datafrete ou `"UNKNOWN"`, `internalId: cte.id`, `createIntegrationError: true`.
- `cte-ingestion.queue.ts`, catch de `syncCteWithDatafrete` (caminho inline por CT-e recém-importado) — mesmo padrão do item acima.
- `cte-ingestion.queue.ts`, catch externo de `fetchAndProcess` (falha ao buscar documentos na Sieg, sem CT-e resolvido ainda) — `type: "SIEG_FETCH_FAILED"`, `reference: logLabel`, `createIntegrationError: true`.
- `cte-ingestion.queue.ts`, catch interno de `fetchAndProcess` (falha no upsert de um CT-e específico) — `type: "CTE_UPSERT_FAILED"`, `createIntegrationError: true`.
- Sieg `cte.service.ts`, `fetchXmlPageWithRetry` (retry intermediário, ainda dentro do limite de tentativas) — `type: "SIEG_PAGE_RETRY"`, `createIntegrationError: false` (só vira falha real, com `createIntegrationError: true`, se esgotar as tentativas e propagar até o catch externo de `fetchAndProcess`, acima).

Bling/Tecinco/ML ainda não usam esse logger — aplicar o mesmo padrão incrementalmente quando alguém for instrumentar essas integrações.
