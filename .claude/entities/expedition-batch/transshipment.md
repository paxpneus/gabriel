# Transbordo (loja que só passa a carga)

Loja com `unit_businesses.transshipment_allowed` (CD) monta lote de nota da qual **não é emissora nem destinatária**. A bipagem decide, nota a nota: `isTransshipmentInvoice(invoice, cnpjDaLoja)` (`expedition/utils/helpers/transshipment-resolver.ts`, CNPJ normalizado). Lote misto é normal: no mesmo lote, notas da loja e notas de transbordo.

## Marca por nota no lote
- `expedition_batch_invoices.is_transshipment` (BOOLEAN NOT NULL default false, `m341`). Gravada em `batchInvoicesService.createBatchInvoiceWithItems(batchId, invoices, t, transshipmentInvoiceIds)`, com os ids que `assertTransshipment` devolveu `true` em `generateBatchFromInvoices`/`addInvoiceToBatch` (os dois ramos).
- Fonte única de "essa nota é transbordo neste lote". Listagem `GET /api/batch` (`ExpeditionBatchService.paginate`) traz `has_transshipment` por lote (`EXISTS` em `expedition_batch_invoices.is_transshipment`, `batch.repository.ts::hasTransshipmentAttribute`). É a base da comparação futura: saída da emissora × entrada no CD × saída do CD × entrada na destinatária.

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

## Rota do QR do romaneio — `POST /api/batch/from-qr-code`
- `[authenticate, userPermissions]`. Body `{ batchId, type?, mode?, blingCheckJobId? }`; `batchId` = o QR do romaneio (id do lote de **expedição** que gerou o romaneio — da emissora, ou do CD na saída do transbordo). Loja = a do usuário logado (`getUserContext`). 201 com o lote; erro → 400 (`batchId` inválido → `"QR do romaneio inválido"`).
- `ExpeditionBatchService.generateBatchFromQrCode(sourceBatchId, unitBusinessId, requestedType?, mode?, blingCheckJobId?)`: lote de origem precisa ser `OUTGOING` (senão `"O QR lido não é de um romaneio de expedição."`) e de outra loja (`"Este romaneio é desta própria loja."`); sem notas → `"O romaneio lido não tem notas."`.
- Papel da loja em cada nota (sempre calculado): **recebida** (destinatária), **emitida** (emissora), **transbordo** → entrada se ainda não tem lote de entrada nesta loja (`batchInvoicesService.findBatchIdsByInvoiceIds(ids, ub, "INCOMING")`, uma consulta só), senão expedição.
- `type` do body (`INCOMING`/`OUTGOING`, opcional; outro valor → 400) é respeitado. Sem ele: `OUTGOING` se alguma nota emitida/transbordo é de expedição (as recebidas não contam), senão `INCOMING`.
- **Entrada**: vai o romaneio inteiro (bipar de novo devolve o lote existente). Nota emitida pela loja com `type` pedido → `"As notas <nºs> são de expedição nesta loja. Use a tela de expedição."`.
- **Expedição**: nota recebida pela loja **termina ali e fica fora do lote** (romaneio da emissora com nota pro próprio CD). Só notas recebidas → `"As notas <nºs> são de entrada nesta loja. Use a tela de entrada."`. Sem `type`, transbordo ainda sem entrada junto com nota de expedição → `"As notas do romaneio não são do mesmo tipo de lote nesta loja: entrada <nºs>; expedição <nºs>."`. Com `type`, o transbordo sem entrada finalizada cai no erro do `assertTransshipment` (nunca vira entrada).
- **Regra CD21 → loja 12/17** (`batch/helpers/cd21-transfer-qr.ts`, avaliada antes de tudo, logo após carregar as notas): romaneio de expedição da loja CD21 (`CD21_UNIT_BUSINESS_NUMBER`) lido por loja cujo `number` está em `ADT_TRANSPORTER_CDS` (12/17), com **todas** as notas emitidas pelo CD21 e `transporter_name` "CD 12"/"CD 17" ou vazio (`isCd21TransferQrRule`; qualquer nota fora disso → fluxo normal acima). Em vez das vendas, gera lote de **entrada** das notas de transferência: `transfer_invoice_reference` de cada venda → número (`extractTransferReferenceNumber`) → `invoiceService.findTransfersToReceiverByNumbers(numeros, cnpj da loja)` (destinatário = loja que leu, emitente = **qualquer outra loja própria** — a transferência não sai necessariamente do CD21; número sem zeros à esquerda). Venda sem REF ou transferência não achada → erro com os números; `type` `OUTGOING` pedido → erro. Depois `generateBatchFromInvoices(transferIds, ub, "INCOMING", ...)` (mesmas travas).
- Nota de outra loja em loja sem `transshipment_allowed` → `"Leitura bloqueada..."` (`assertTransshipment`), barrando o romaneio todo. **Proposital**: loja comum recebe pelo QR do romaneio da emissora; romaneio do CD com notas de várias lojas é recebido pelo desktop ou bipando a chave de acesso das notas.
- Destinatária que também é CD recebe pelo romaneio do **último** CD da rota. Pelo romaneio da emissora, as notas que pararam num CD anterior entram como transbordo nela (ou dá "misturar notas já processadas" se ela já recebeu). Proposital, sem trava.
- Depois só chama `generateBatchFromInvoices(ids, ub, type, mode, blingCheckJobId)`: todas as travas de sempre (não mapeado, conciliação Bling — o front chama `POST /bling-reconciliation-check` antes, PDV crítico) e a marca de transbordo por nota. Bipar de novo um QR já processado devolve o lote existente (notas já processadas).
- Etiqueta de volume: "já lido" só no lote atual (`scan-logs.service.ts::scanProduct`), então o CD bipa as mesmas etiquetas da emissora na entrada e na saída.

## Fase futura (não implementada)
Comparar a quantidade conferida (`batch_invoice_items.quantity_read`) em cada etapa da nota: saída da emissora × entrada no CD × saída do CD × entrada na destinatária (`is_transshipment` identifica as etapas do CD).
