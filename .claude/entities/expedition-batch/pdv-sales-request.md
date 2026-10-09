# Lote de saída a partir de PdvSalesRequest (CD21)

Sempre unit business CD21 (`unitBusinessService.getCd21UnitBusiness()`), `type: OUTGOING`. Só orquestram funções existentes de `ExpeditionBatchService`; a nota é sempre `order.invoice_id`, re-sincronizada em lote por `pdvSalesRequestService.resolveSaleInvoiceIds(ids)` (2 queries: solicitações + pedidos; atualiza `sale_invoice_id` defasado; notas distintas na ordem dos ids; qualquer pedido sem nota bloqueia a chamada inteira — `"Pedido(s) sem nota de venda: <números>"`). Notificação: `notifyChangedBySaleInvoiceIds(invoiceIds)` (1 sync de Kanban por loja).

## 3 ações, por coluna

`PdvBatchActionParams` (`batch.types.ts`): `status` (coluna do PDV) + transportadora opcional + `salesRequestIds?`. Colunas válidas: `PDV_BATCH_COLUMNS` (`SHIPPING`, `SHIP_TODAY`); mensagens usam `CD21_STATUS_LABELS` (`next-action.rules.ts`). Transportadora (`resolvePdvTransporter`, `PdvTransporterSelector`): `SHIPPING` (ADT) usa `cd` em `ADT_TRANSPORTER_CDS` → `{ cd }` (casa pelo NOME, `"... - CD <n>"`); `SHIP_TODAY` usa `transporterId` → `{ transporterId }`; transportadora do tipo errado pra coluna → erro. SQL do seletor é um só (`transporterSelectorSql`, `sales-request/helpers/transporter-cd.ts`), usado pras solicitações e pros lotes.

Regras por ação em `PDV_BATCH_ACTION_RULES`: `defaultStage` (o que pega sem ids), `selectedStage` (o que as escolhidas precisam estar), `groupByTransporter`, `selectedNotInStage` (mensagem amigável, singular/plural, com números de pedido). Candidatas sempre por `pdvSalesRequestService.findBatchTargets(filter)` → `repository.findBatchTargets` (`ids`/`status`/`transporter`/`batchStage`, todos opcionais; devolve `id, sale_invoice_id, order_number, transporter_id, transporter_name` da nota de venda, mais antigas primeiro).

`resolvePdvBatchGroups(params, rule)` → `{ groups, skipped }`:
- **Só `salesRequestIds`, sem transportadora (card)**: sem checar coluna/transportadora (`status` ignorado). `resolveSaleInvoiceIds` primeiro (re-sincroniza `sale_invoice_id`, que o literal de estágio lê), depois confere `selectedStage` → `"A solicitação do pedido X já está em um lote."` / `"Nem todas as solicitações estão sem lote. Já em lote: pedidos …"`. 1 grupo, `transporter: null`.
- **Ids + transportadora**: todas precisam estar na coluna + transportadora (`"Nem todas as solicitações selecionadas estão em "<coluna>" da <transportadora>. Fora: pedidos …"`), depois o mesmo check de estágio. 1 grupo.
- **Sem ids, com transportadora**: todas da coluna + transportadora no `defaultStage`. 1 grupo.
- **Só a coluna**: todas da coluna no `defaultStage`; com `groupByTransporter` (gerar/adicionar) um grupo por `transporter_id` da nota de venda — nota sem transportadora vira `skipped` `NO_TRANSPORTER`; romaneio, 1 grupo.
- Sem candidata → `"Nenhuma solicitação <estágio> em "<coluna>"[ da <transportadora>]."`.

Resposta das 3: `PdvBatchActionResult` = `{ batches, skipped, warnings }`. `skipped` (`PdvBatchSkipped`): `reason_code` (`NO_PENDING_BATCH`/`NO_TRANSPORTER`/`FAILED`), `reason`, transportadora, `sales_request_ids`, `order_numbers`. `pdvBatchActionResult`: nada processado → erro (1 skipped → a `reason` dele; senão os `warnings` juntos); parcial → 2xx com avisos (`pdvBatchWarnings`: `NO_PENDING_BATCH` numa frase só com as transportadoras, `FAILED` = `<transportadora>: <erro>`).

- `generateBatchFromPdv(params)` — `WITHOUT_BATCH`; `generateBatchFromInvoices(invoiceIds, cd21, "OUTGOING", "REGULAR")` por grupo, **sequencial** (`setBatchNumber` numera pelo último lote do CD21 — em paralelo repetiria número); falha do grupo → `FAILED`. `POST /pdv-sales-requests/generate` (201).
- `addPdvToBatch({ ...params, batchId? })` — `WITHOUT_BATCH`; `batchId` só com ids ou transportadora (só a coluna + `batchId` → erro). Por grupo (`Promise.all`): `expeditionBatchRepository.findPendingOutgoingByTransporter(cd21, group.transporter, batchId?)` (OUTGOING `OPEN`/`PENDING` do CD21 cuja transportadora — do lote via `transporters_id` OU de qualquer nota dele — bate com o seletor, mais recente primeiro); nenhum → `NO_PENDING_BATCH`, nunca cria. Só a coluna usa `{ transporterId }` da nota. **Só ids sem `batchId`**: comportamento antigo — reconcilia o ponteiro (`getOrUpdateLastOutgoingBatchNumber`) e `addInvoiceToLastOutgoingBatch` (cria lote se não houver). Depois `addInvoiceToBatch` com os `xml_key` (`saleInvoiceAccessKeys`). `POST /pdv-sales-requests/add`.
- `generateDeliveryNoteFromPdv(params, userId)` — padrão `FINISHED_WITHOUT_DELIVERY_NOTE`; escolhidas só precisam estar em lote (`IN_BATCH`, finalizado ou não). `batchIdsOfSaleInvoices` → `generateDeliveryNote` por lote distinto (`Promise.all`, tudo ou nada). `userId` = usuário logado. `POST /pdv-sales-requests/delivery-note`.
- `findPdvPendingBatches(params)` — mesmo `findPendingOutgoingByTransporter` (sem `cd`/`transporter_id` → todos os pendentes de saída do CD21), opções de `batch_id` pro `add` (`id, number, status, total_volumes, delivery_note_generated_at, createdAt`). `GET /pdv-sales-requests/pending-batches`.

Estágios (`PdvBatchStage`) vêm de `saleInvoiceCd21BatchStageLiteral` (`sales-request/helpers/custom-filters.ts`) — os mesmos dos filtros `transporter_*`/`adt_*` da listagem, então a lista filtrada bate com o que a ação pega no modo padrão.

Controller: `pdvBatchParams(req)` junta query + body (`status`, `cd` só dígitos, `transporter_id`, `sales_request_ids` precisa ser lista). Não existem rotas de lote por solicitação avulsa — tudo passa por estas 3.

## Leitura

- `getPdvSalesRequestBatchStatus(id)` → `{ in_batch, batch_finished, delivery_note_generated }` (`batch_finished` = lote do CD21 com `status = FINISHED`; `delivery_note_generated` = `delivery_note_generated_at` preenchido; ambos `false` se não está em lote). `GET /in-batch/pdv-sales-request/:salesRequestId`. A lógica vive em `getBatchStatusByInvoiceId(invoiceId)`, também usado por `PdvSalesRequestService.findByIdWithOrder` (`expedition_progress`).
- Link CD21 (sem id de loja do front; sempre CD21): `GET /unit-business/last-outgoing-batch-number/get-or-update` e `GET /expedition-batches/outgoing-pending/search` são as rotas de login de sempre, com middleware `authenticateOrPdvLink([CD21], [<login mws>])` (`pdv-access.middleware.ts`): header `x-pdv-token` presente → só valida o link e força CD21; ausente → `authenticate` (+ `userPermissions`).

Auth: as 3 ações (`generate`, `add`, `delivery-note`) usam `pdvLoginAccess([CD21])` (`pdv-access.middleware.ts`) — só usuário logado cuja tela resolve pra CD21; link `x-pdv-token` não vale (sem login → 401). `pending-batches` e `in-batch/...` seguem `pdvAccess([CD21])` (link ou login).
