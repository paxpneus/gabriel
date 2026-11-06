# Transbordo (loja que só passa a carga)

Loja com `unit_businesses.transshipment_allowed` (CD) monta lote de nota da qual **não é emissora nem destinatária**. A bipagem decide, nota a nota: `isTransshipmentInvoice(invoice, cnpjDaLoja)` (`expedition/utils/helpers/transshipment-resolver.ts`, CNPJ normalizado). Lote misto é normal: no mesmo lote, notas da loja e notas de transbordo.

## Marca por nota no lote
- `expedition_batch_invoices.is_transshipment` (BOOLEAN NOT NULL default false, `m341`). Gravada em `batchInvoicesService.createBatchInvoiceWithItems(batchId, invoices, t, transshipmentInvoiceIds)`, com os ids que `assertTransshipment` devolveu `true` em `generateBatchFromInvoices`/`addInvoiceToBatch` (os dois ramos).
- Fonte única de "essa nota é transbordo neste lote". É a base da comparação futura: saída da emissora × entrada no CD × saída do CD × entrada na destinatária.

## Linhas de atributo (`invoice_unit_business_attributes`)
- Unique `(invoice_id, unit_business_id, type)` (`m341`, antes era sem `type`). A loja de transbordo tem **2 linhas** por nota (INCOMING e OUTGOING), com `status`/`batch_generated` independentes. Emissora e destinatária continuam com **1 linha**, a da ingestão.
- `assertTransshipment(invoice, unitBusiness, type, t?)` → `boolean`:
  - emissora/destinatária → `false`, usa a linha que existir (qualquer `type`); só cria (INCOMING, como sempre) se faltar;
  - nem emissora nem destinatária sem `transshipment_allowed` → `"Leitura bloqueada..."`;
  - transbordo → `true`, garante a linha **do `type` do lote**;
  - transbordo + `OUTGOING` → exige a linha INCOMING da loja `FINISHED`, senão `"Nota <nº> ainda não foi recebida nesta loja. Finalize o lote de entrada antes de gerar o de expedição."`. Vale também nos scans (`scan-logs.service.ts` chama com o `type` do lote).
- **Leitura**: `pickBatchAttribute(rows, type, isTransshipment)` — transbordo pega a linha do `type` do lote (nunca a outra); fora dele, a única linha (`[0]`, comportamento de sempre). Usado em `generateBatchFromInvoices`, `batch.repository.ts::normalizeBatchPlain` e `invoice-items.service.ts::syncBatchFromInvoice`.
- **Escrita**: `batchAttributeWhere(type, transshipmentInvoiceIds)` como `attrWhere` de `invoiceService.updateInvoices` — nota de transbordo só mexe na linha do `type` do lote; as demais sem filtro de `type`. **Não** filtrar por `type` toda nota: há loja emissora com lote INCOMING da própria nota (linha de outro type), e o filtro deixaria de marcar `batch_generated`/status. Usado em `generateBatchFromInvoices` (agora na transação, porque a linha do transbordo nasce nela), `addInvoiceToBatch`, `finishBatchTransaction`, `removeBatchInvoice` e `scan-logs.syncFromScanning`.
- "Já pertence a outro lote nesta unidade" (`addInvoiceToBatch`): para nota de transbordo só conta lote do mesmo `type`; para as demais, qualquer lote da loja (regra de sempre). O reaproveitamento de lote de `generateBatchFromInvoices` (notas já processadas) busca o lote da loja (`batchInvoicesService.findBatchIdByInvoiceId(invoice, ub, type?, t)`), com `type` só no transbordo. Antes não filtrava nem loja.
- `total_read` (`invoice/helpers/totals.ts::totalReadLiteral(ub, alias, batchType?)`) soma só os lotes do `type` quando ele vem: no detalhe do lote (`batchInvoicesInclude`) e nas listagens com um `filters[type]` só.

## Tecinco e estoque
- `conferencia-estoque-post.service.ts::postarConferenciaPorLote` ignora `is_transshipment = true`. A mecânica de sempre (destinatária posta entrada, emissora posta expedição) não muda. Lote só com transbordo → `[]`, sem erro (não trava o `finishBatch`).
- `stock-movements.service.ts`: nota em que a loja não é emissora nem destinatária não gera movimento. Movimentos antigos não foram tocados.

## Nota → lote (`Invoice.hasOne(ExpeditionBatchInvoice, as "batchInvoice")`)
O hasOne devolve **um vínculo qualquer** quando a nota tem vários (emissora, CD entrada, CD saída, destinatária). Regras:
- Listagens (`GET /invoice`, transferência) e detalhe (`GET /invoice/full/:id`): `where` do próprio `batchInvoice` via `invoice/helpers/batch-invoice-scope.ts::batchInvoiceScopeWhere(ub, types)` (`EXISTS` no lote da loja; nota de transbordo só do `type` pedido). Filtrar só o include `batch` não basta: o hasOne pode escolher o vínculo cujo lote foi filtrado e o lote vem vazio.
- Telas da loja de transbordo mandam `filters[type]` na listagem e `?type=` no detalhe (`findByIdFullWithBatch(id, ub, type?)`, que também filtra a linha de atributo). Sem `type`, a nota de transbordo mostra um dos dois.
- PDV (CD21): lote é sempre de saída. `type = 'OUTGOING'` em `CD21_BATCH_INCLUDE`, `saleInvoiceCd21BatchStageSql`, `orderMissingGeneratedDeliveryNoteLiteral` e nas buscas `findBatchIdByInvoiceId`/`findBatchIdsByInvoiceIds` do CD21.
- Cancelamento tira a nota de **todo** lote aberto (`findOpenIdsByInvoiceId`, ver `../invoice/index.md`).
- Sem mudança: `findInvoicesPendingLogisticOccurrence`, `findDeliveryNoteGeneratedInvoiceIds`, `helpers/delivery-note.ts` (restritos à loja emissora/destinatária ou à própria loja).

## Relatório de operação diária
Snapshot por `(invoice_id, unit_business_id, type)` + `is_transshipment`; no fato do dia o transbordo fica fora dos indicadores normais e conta em `transshipment_incoming_count`/`transshipment_outgoing_count`. Detalhes em `../../modules/reports.md` (`daily-operation/`).

## Pendente
- Rota do QR do romaneio (`POST /api/batch/from-qr-code`, body `{ batchId }` do lote de expedição): `type` resolvido por nota (emissora → expedição, destinatária → entrada, transbordo → entrada se ainda não tem lote de entrada na loja, senão expedição).
