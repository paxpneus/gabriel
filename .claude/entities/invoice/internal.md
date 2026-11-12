# Nota interna (série B Tecinco)

`invoice/internal/` (domínio nível 2; fachada `internal/index.ts`, exportada pelo `invoice/index.ts`). Sync/fila: `.claude/modules/tecinco-api.md` ("Nota interna").

- O que é: série `B`, `modelo_documento 1` na Tecinco, sem `chave_nfe` e sem XML, sem valor fiscal; sempre transferência entre lojas. Tem expedição e entrada.
- `invoice_operation_id` = `INVOICE_OPERATION_CODES.INTERNAL_TRANSFER` (nunca o literal do code). Sem a operação no banco: `upsertInternalInvoice` lança (sem ela a nota vazaria pras listagens de NF-e) e a dedup do sync devolve vazio.
- `upsertInternalInvoice` (`internal.service.ts`), chamado só pelo `TCarInvoiceQueue.processInternalInvoice`:
  - `id_system = TCAR-INTERNAL-<cnpj emitente>-<nota>` (`buildInternalInvoiceIdSystem`): S na origem e E no destino caem na mesma linha (`findIdByIdSystem`).
  - `xml_key`/`xml_path`/`danfe_path` null, `invoice_series` = `chave.serie`, `source_payload` = detalhe Tecinco, transportador = placeholder "Sem transporte" (`resolveTransporter` sem documento), loja "Outros" só no create (update não troca).
  - Valores de `totais` (`valor_nota`/`valor_produtos`/`valor_frete`/`valor_desconto`/`valor_ipi`); `emitted_at` = `cabecalho.emissao` à meia-noite de Brasília.
  - Itens: produto do `ensureProductsFromInvoiceItems` + item fiscal do detalhe pelo `epeit_seq` (`buildInternalInvoiceItems`: qtd, unitário, líquido, % e valor de ICMS).
  - Status inicial = regra do `invoice-xml.ts`: cancelada → CANCELLED; S → OPEN; E → WAITING_SCHEDULE_SALES (com as 2 lojas, o emitente é sempre OUTGOING OPEN — `createWithRelations`).
  - Create → `createWithRelations`; update → `updateWithAttributesForAllUnits` + `ensureUnitBusinessAttributes` + `addMissingInvoiceItems`.
  - Não mapeados: mesma reconciliação do `invoice-xml.ts` (chave `ean:`/`sku:`; UNMAPPED que sumiu é apagado; resolvido manualmente fica), em lote pelo `unmappedInvoiceProductService` (1 leitura, sem query por item). O `invoice-xml.ts` não é usado nem alterado.
- Dedup do sync: `findExistingInternalNumbers(lado, cnpjFilial, números)` — S → `sender_cnpj`, E → `receiver_cnpj`, só operação interna. Risco: dois emitentes com o mesmo número B pro mesmo destino na janela de 300 → o segundo é pulado.
- Listagens:
  - `GET /api/invoice/internal/list` (`internal.controller`, montado no `invoice.routes.ts` antes do core; `[authenticate, userPermissions]`, permissão de Notas pela URL): mesmos filtros e projeção do `/transfer/list` (`buildTransferInvoiceQueryOptions` + `mapListedInvoice` + `invoiceQueryConfig`), só `invoice_operation_id` = interna, sem recorte de CNPJ. `unitBusinessId`/`filters[unit_business_id]` opcional (sem ele, todas as lojas). Sem a operação no banco → 500.
  - Fora da nota interna: `GET /invoice` (`listInvoices`), `/transfer/list` (`listTransferInvoices`) e `/report/transfer` (`findAllTransferInvoices`), via `notInternalInvoiceWhere` (`shared/helpers/invoice-operation.ts`: `invoice_operation_id IS NULL OR != interna` no forcedWhere; sem a operação cadastrada não filtra). Relatórios de produto/fornecedor e o detalhe (`GET /:id`, `/full/:id`, usado pelo lote) não mudam. Etiqueta/XML/DANFE não se aplicam (o front não chama pra nota interna).
- Ainda não feito (fase E): lote/scan da nota interna, conferência Tecinco pela chave composta, exclusão nas checagens de referência de transferência e no QR do CD21.
