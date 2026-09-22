<!-- Next session: Etapa 1/Passo A recém-implementado, ainda não testado manualmente ponta a ponta em ambiente real (migrations criadas mas não rodadas pelo usuário). Confirmar contra o estado real do banco antes de assumir que a tabela existe. -->

# PDV Management — solicitação de pedido de venda

`src/modules/sales/pdv-management/` — módulo de acompanhamento do fluxo Loja → Financeiro → CD21 pro PDV (pedido digitado na Bling, comprovante conferido, nota de venda + nota de transferência quando ADT, expedição). Duas submódulos:
- `sales-request/` — `PdvSalesRequest` (model/repository/service/controller/routes), tabela `pdv_sales_requests`.
- `sales-request-history/` — `PdvSalesRequestHistory`, tabela `pdv_sales_request_histories`. Boilerplate puro (sem controller/routes próprios — histórico só é lido via `GET /sales-request/:id/history`, escrito só pela máquina de estados).

**Escopo atual: só Etapa 1 / Passo A** (estrutura + máquina de estados + vínculo manual de nota de transferência). Passo B (extração por IA do comprovante/DANFE via Gemini) e Etapa 2 (autenticação por link/token sem login, permissões por tela) ainda não existem — ver "Pendências" no fim.

## Schema

`pdv_sales_requests`: `order_id` (FK `orders`, `CASCADE`, sem unique — service impede 2ª solicitação ativa pro mesmo pedido via `findActiveByOrderId`, não é constraint de banco), `sale_invoice_id` (FK `invoices`, `SET NULL`, espelhado de `order.invoice_id` na criação e re-sincronizado em `markSaleInvoiceReady` — nunca setado via API), `transfer_invoice_id` (FK `invoices`, `SET NULL`, só ADT), `status`/`correction_origin_status` (mesmo enum `PdvSalesRequestStatus`), `shipping_type` (`TRANSPORTADORA`|`ADT`), `name`, `payment_receipt_path`, `errors` (JSONB — `{origin, reasons, note}` da correção mais recente), `created_by_user_id` (nullable, `SET NULL`).

`pdv_sales_request_histories`: `pdv_sales_request_id` (FK, `CASCADE`), `step` (reaproveita literalmente `Object.values(PdvSalesRequestStatus)` — nunca redefinido separado, pra não divergir), `description`, `date`, `user_id` (nullable, `SET NULL`).

Não existe tabela pra "motivos de correção possíveis" — é a constante `CORRECTION_REASONS_BY_ORIGIN` (`pdv-sales-request.types.ts`), indexada por `PdvCorrectionOrigin` (`FINANCE`/`CD21_ANALYSIS`/`EXPEDITION`).

## Máquina de estados (`pdv-sales-request.service.ts`)

Ponto único de escrita de `status`: `transitionTo()` (privado) grava o status e a linha de histórico na mesma transação — nenhum método de negócio escreve `status` fora dele. Fluxo: `OPEN → PENDING_FINANCE → PENDING_CD21_ANALYSIS → PENDING_NF_SALE → (ADT ? PENDING_NF_TRANSFER : SHIPPING) → SHIPPING → FINISHED`. `PENDING_CORRECTION` é alcançável de `PENDING_FINANCE`/`PENDING_CD21_ANALYSIS`/`SHIPPING` (`correction_origin_status` grava de onde veio); `resolveCorrection` volta pra origem, exceto origem `SHIPPING` que exige `decision: "CANCEL"|"EXCHANGE_PRODUCT"` (`CANCEL → CANCELLED`; `EXCHANGE_PRODUCT → PENDING_CD21_ANALYSIS`, decisão confirmada com o usuário: troca de produto pode impactar a NF já gerada, por isso reanálise completa em vez de voltar direto pra `SHIPPING`).

`INVOICE_CANCELLED` é o único status alcançável fora do fluxo normal — via `handleInvoiceCancelled(invoiceId)`, chamado por `invoice-xml.ts`/`bling-api-fetch.queue.ts` (ver `.claude/entities/invoice/index.md`) quando a nota de venda ou transferência vinculada é cancelada pela Bling/Tecinco. Não decide sozinho pra onde volta (reabrir vs. criar nova solicitação) — regra ainda não fechada com o time, fica bloqueado até ação humana.

## Nota de transferência (`attachTransferInvoice`)

Três formas de vincular, nesta ordem de prioridade: (1) `invoiceId` — o front já resolveu via `searchTransferInvoiceCandidates` (busca local por `number_system`/`id_system`, só leitura, não dispara nada na Tecinco); (2) `xmlBuffer` — chama `TCarUpsertQueue.upsertInvoiceFromXml(xmlContent, branchId)` (método já existente, valida contra a API da Tecinco pela chave de acesso e upserta local), depois localiza a invoice recém-upsertada por `xml_key` (extraído localmente via `shared/utils/xml/access-key.ts`, regex simples — não usa `extractInvoiceIdentificationFromXml` de `invoice-xml.ts` de propósito, pra evitar import circular já que `invoice-xml.ts` chama este service no hook de cancelamento); (3) `danfeBuffer` — extrai a chave de 44 dígitos via `helpers/danfe-interpreter.ts` (`pdf-parse` + regex, só funciona com PDF nativo/texto selecionável) e busca local por `xml_key`. **Não existe fluxo de busca on-demand na API da Tecinco por chave/número** — se a nota não estiver localmente e não vier XML, o método falha pedindo o XML (a Tecinco não expõe esse endpoint; só o upload de XML valida contra a API).

`branchId` (necessário pro `upsertInvoiceFromXml`) é resolvido via `order.unit_business_id → UnitBusiness.number`, não via usuário logado (`resolveTecincoBranchId` genérico depende de `userId`, que este módulo não tem garantido).

## Rotas e auth

`pdv-sales-request.controller.ts` **não usa `authenticate`/`userPermissions`** — decisão explícita do usuário, o controle de acesso deste módulo é só via token de link (Etapa 2, não implementada). Rotas hoje ficam **sem proteção nenhuma** — pendência bloqueante antes de produção, não esquecimento. `update`/`destroy`/`bulkCreate`/`bulkUpdate`/`bulkDestroy` (genéricos do `BaseController`) são sobrescritos pra retornar 405 — mudar status só pelos endpoints de transição dedicados, nunca por PUT genérico (senão pula a máquina de estados e o histórico).

## Pendências (Passo B / Etapa 2 — não implementadas)
- Extração por IA (Gemini) do comprovante (schema fixo de campos, validação matemática parcela×valor, fingerprint de duplicidade) e fallback de IA pra DANFE fotografado/escaneado — hoje `attachReceiptAndShippingType` só salva o arquivo, sem análise; `attachTransferInvoice` com `danfeBuffer` só funciona com PDF de texto nativo.
- Comparação forma de pagamento (`orders.payment_method_id`) × comprovante — depende da extração acima.
- Autenticação por link/token sem login (loja/financeiro/televendas) e permissões por tela.
