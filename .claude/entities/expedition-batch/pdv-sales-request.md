# Lote de saída a partir de PdvSalesRequest (CD21)

Sempre unit business CD21 (`unitBusinessService.getCd21UnitBusiness()`), `type: OUTGOING`. Só orquestram funções existentes de `ExpeditionBatchService`; a nota é sempre `order.invoice_id`, re-sincronizado em `pdvSalesRequestService.resolveSaleInvoiceId(id)` (atualiza `sale_invoice_id` se defasado; erro se o pedido ainda não tem nota).

- `generateBatchFromPdvSalesRequest(id)` → `generateBatchFromInvoices([invoiceId], cd21, "OUTGOING", "REGULAR")`. `POST /expedition-batches/generate-from-pdv-sales-request/:salesRequestId`.
- `generateDeliveryNoteFromPdvSalesRequest(id, userId?)` → acha o lote da nota no CD21 (`batchInvoicesService.findBatchIdByInvoiceId`) e chama `generateDeliveryNote`. `GET /expedition-batches/delivery-note/pdv-sales-request/:salesRequestId`. `userId` = logado se via LOGIN, senão `query.userId`.
- `addPdvSalesRequestToPendingBatch(id)` → reconcilia o ponteiro (`getOrUpdateLastOutgoingBatchNumber`) e chama `addInvoiceToLastOutgoingBatch` com o `xml_key` da nota (cria lote novo se não houver pendente). `POST /expedition-batches/add-pdv-sales-request-to-pending/:salesRequestId`.
- `getPdvSalesRequestBatchStatus(id)` → `{ in_batch, batch_finished, delivery_note_generated }` (`batch_finished` = lote do CD21 com `status = FINISHED`; `delivery_note_generated` = `delivery_note_generated_at` preenchido; ambos `false` se não está em lote). `GET /expedition-batches/in-batch/pdv-sales-request/:salesRequestId`. Sem nota no pedido → 400 (via `resolveSaleInvoiceId`). A lógica vive em `getBatchStatusByInvoiceId(invoiceId)`, também usado por `PdvSalesRequestService.findByIdWithOrder` (`expedition_progress`, só em SHIPPING).

Auth das 4 rotas: `pdvAccess([CD21])` (link ou login), não `authenticate`/`userPermissions`. Não exigem status específico da solicitação.
