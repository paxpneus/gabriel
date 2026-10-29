# Import manual (`/api/manual-import`)

Código: `src/modules/integrations/manual-import/`. Busca na API da integração → usuário escolhe → enfileira com prioridade máxima → front acompanha por polling. Substituiu o antigo `POST /bling-sync/populate-by-id`.

Contrato pro front: `docs/manual-import/frontend-integration.md` (atualizar junto quando mudar rota/resposta).

## Estrutura (padrão adapter + resolver de `handlers/logistic`)
- `manual-import.types.ts` — contrato `ManualImportHandler` (`getIntegration`, `supportedSearches`, `localIdSearchBy`, `queueKeys`, `queueFor`, `search`, `findLocalIds`, `findExternalIdByLocalId`, `enqueue`).
- `providers/bling.handler.ts`, `providers/tecinco.handler.ts` — um por integração.
- `manual-import.resolver.ts` — escolhe o handler comparando `integrationId` com `(await handler.getIntegration()).id`; integração não configurada fica fora (`Promise.allSettled`). Integração nova = uma entrada em `MANUAL_IMPORT_HANDLERS`.
- `manual-import.service.ts` — busca, cache da busca, confirmação, status. `manual-import-run.service.ts` — lock do usuário, claims por item, andamento.
- `manual-import.constants.ts` — prioridade, limite 10, nome do job, chaves/TTLs Redis, avisos.
- Rota carregada automaticamente (sem model → sem checagem de permissão por entidade, igual bling-sync); só `authenticate`. Filas vêm de `req.app.locals`. Requester = `getRequester` (`middlewares/auth-token.ts`): user ou application.

## Busca suportada
| | Bling | Tecinco |
|---|---|---|
| product | `id` → `GET /produtos?idsProdutos[]=` · `name` → `?nome=` | `id` (= `epctb_codigo`) → `GET /produtos?codigo_integracao=` · `name` → `?nome=`; ambos `include=filiais&branch_ids=12,17` (`tecincoUnitBusinessForPopulate`), sessão na 1ª filial |
| invoice | só nota de venda (NF-e de saída, nunca NFC-e): `id` → `GET /nfe/{id}` (404 = não achou) · `number` → `GET /nfe?numero=&tipo=1` | `access_key` → nNF/CNPJ da chave (`parseAccessKey`, `shared/utils/xml/access-key.ts`) → `GET /notas-fiscais/{n}?chave_nfe=`; filiais consultadas em paralelo: UnitBusiness com o CNPJ do emitente **primeiro** (mesmo fora de `tecincoUnitBusinessForPopulate` — numa transferência a saída com XML fica na emitente; a entrada na loja destino pode ter sido lançada sem XML e dar 404 no `/xml`), depois as filiais Tecinco de fallback (emitente de fora/fornecedor); fica a primeira **na ordem** que respondeu; só 404 em todas = não achou |
| order | `id` → `GET /pedidos/vendas/{id}` · `number` → `?numero=` | — |

- `by: "local_id"` (UUID local) em toda combinação: o handler acha o id externo (produto: `integration_mappings` principal, depois o mais recente — `updatedAt` muda a cada sync de `erp_data`; nota: `id_system` na Bling / `xml_key` na Tecinco, escopado em `integrations_id`; pedido: `id_order_system`) e refaz a busca por `localIdSearchBy`. Sem vínculo → 422 `LOCAL_RECORD_NOT_LINKED`.
- Listagem pega só a 1ª página (100) → `truncated` quando veio cheia.
- `existsLocally`/`localId`: uma consulta com `Op.in` (produto via mapping; nota Bling `id_system`+integração; nota Tecinco só `xml_key` — o upsert casa por chave; pedido `id_order_system`+integração).
- `importable: false` só em nota Bling: de entrada (`tipo` ≠ 1, só aparece na busca por id) ou anterior ao corte (`isKnownBlingInvoiceBeforeCutoff`).
- Produto Tecinco: a busca é só `GET /produtos` (1 chamada). `skuDuplicated`/`eanDuplicated` **não** são calculados na busca — o cache do índice de duplicidade é por processo e na API está sempre frio (baixava o catálogo inteiro por busca → timeout). O job vai com `detectCatalogDuplicates: true` e o worker calcula (`TCarUpsertQueue.detectCatalogDuplicateFlags`, cache aquecido pelo sync).

## Fluxo
0. `GET /options` → `{ maxItems, integrations: [{ integrationId, name, entities: [{ entity, label, searchBy: [{ by, label }] }] }] }`, montado do `supportedSearches` + `localIdSearchBy` de cada handler (não há tabela duplicada). Labels em `MANUAL_IMPORT_ENTITY_LABELS`/`MANUAL_IMPORT_SEARCH_BY_LABELS`.
1. `POST /` `{ integrationId, entity, by, value }`. Ordem: handler (400 `INTEGRATION_NOT_SUPPORTED`) → `by` suportado (400 `UNSUPPORTED_SEARCH`) → import do usuário rodando (409 `USER_IMPORT_RUNNING`, sem chamar API) → busca. 0 → `NOT_FOUND`; 1 ou mais → 200 `CHOOSE` (mesmo com 1 resultado — o usuário sempre confere antes; a busca nunca enfileira) e grava cada resultado em `manual-import:search:<requesterId>:<integrationId>:<entity>:<externalId>` (30min) com o `enqueueData` que o job precisa.
2. `POST /confirm` `{ integrationId, entity, externalIds }` — >10 → 400 `MAX_ITEMS_EXCEEDED` (checado no service, não no zod). Por item: fora do cache → `SEARCH_EXPIRED`; `NOT_IMPORTABLE`; claim vivo de outro → `ALREADY_PROCESSING` + `processingBy {id,type,name}`; falha no `add` → `ENQUEUE_FAILED`; senão `ENQUEUED`. 202 com `run` se algo entrou, senão 200 sem `run` (lock solto).
3. `GET /status` → `{ run (atual ou último do usuário), othersRunning: {[integrationId]: bool}, maxItems }`.

`warnings: OTHER_MANUAL_IMPORTS_RUNNING` = `hasPendingJobsNamed(["manual-import"])` nas filas do handler — não distingue de quem é o job (inclui os do próprio usuário) e lista todos os jobs pendentes da fila (custo cresce com backlog).

## Locks/claims (Redis)
- Usuário: `manual-import:user:<id>:lock` (SET NX, valor = runId, TTL 6h só pra crash) + registro `manual-import:user:<id>:run` (TTL 7d).
- Item, global por integração: `manual-import:item:<integrationId>:<entity>:<externalId>` (SET NX, valor JSON `{runId, requestedBy, jobRef}` serializado campo a campo). Claim cujo job já está em estado final é trocado por compare-and-set (Lua) — dois pedidos simultâneos nunca enfileiram o mesmo item. Job `not_found` só libera o claim se ele tiver ≥30s (idade pelo `PTTL` da chave): o claim é gravado antes do job existir, e sem isso o 2º pedido via "sem job" e enfileirava de novo (`isClaimReleasable`). Só import manual passa por isso (sync/webhook não).
- Sem processo em background: `evaluate` calcula o andamento com `getJob` por item (≤10, paralelo) via `toJobStatus` (`shared/utils/queues/job-status.ts`, também usado pelo unmapped). Tudo final (`completed`/`failed`/`not_found`) → grava snapshot FINISHED (status/erro/resultado por item, porque o completed some do Redis em 24h) e solta lock + claims por compare-and-delete (claim já sobrescrito por outro runId fica). Roda no `GET /status` e nos dois POSTs antes do 409. Retry do BullMQ (`delayed`) conta como pendente.

## Jobs
- Nome `manual-import`, jobId `manual-import-<entity>-<externalId>-<runId>`, `priority: 1` (`MANUAL_IMPORT_PRIORITY`; empata FIFO com os outros jobs manuais nas filas Bling/`TCAR_API_FETCH`; na `TCAR_INVOICE` é o único com 1, à frente até do `invoice-new` (2)), `removeOnComplete: { age: 24h }`.
- Bling: produto → `BLING_API_FETCH` `product` (sem `create` — produto sem mapping vira unmapped como no webhook); nota → `invoice` (NF-e) com `partialData`; pedido → `BLING_ORDER_INGESTION` `order.updated` (cria se não existe). Payload/listagem via `bling-sync/helpers/bling-list.ts`.
- Tecinco: produto → `TCAR_API_FETCH` `product` com o payload da busca + `detectCatalogDuplicates: true`; nota → `TCAR_INVOICE` `invoice_by_key` (`{numero, chaveAcesso}` + `branchId`) → `upsertInvoiceFromTecinco`.
- `result` no status = `job.returnvalue` ou `IMPORTED`. Só `invoice_by_key` devolve algo diferente: `IGNORED_NO_TIRE_ITEMS` (nota sem item de pneu, completa sem importar).
- `enqueueProductSync(integrationId, externalId, queues)` — fora do fluxo de busca/confirm: `handler.search("product","id")` + `handler.enqueue`, sem lock de usuário nem claim de item, jobId `primary-mapping-sync-product-<externalId>-<ts>`. Usado na troca do mapping principal (`integration-mapping.service` `updateForProduct`); `null` = integração sem handler ou código não achado.
- Prioridade vale só pro job do import; rate limit global Bling/Tecinco e as etapas seguintes do pipeline de pedido não mudam.
