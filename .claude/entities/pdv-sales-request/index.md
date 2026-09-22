<!-- Next session: Etapa 1/Passo A recém-implementado, ainda não testado manualmente ponta a ponta em ambiente real (migrations criadas mas não rodadas pelo usuário, m285 já inclui unit_business_id desde a criação). Confirmar contra o estado real do banco antes de assumir que a tabela existe. -->

# PDV Management — solicitação de pedido de venda

`src/modules/sales/pdv-management/` — módulo de acompanhamento do fluxo Loja → Financeiro → CD21 pro PDV (pedido digitado na Bling, comprovante conferido, nota de venda + nota de transferência quando ADT, expedição). Duas submódulos:
- `sales-request/` — `PdvSalesRequest` (model/repository/service/controller/routes), tabela `pdv_sales_requests`.
- `sales-request-history/` — `PdvSalesRequestHistory`, tabela `pdv_sales_request_histories`. Boilerplate puro (sem controller/routes próprios — histórico só é lido via `GET /sales-request/:id/history`, escrito só pela máquina de estados). `delete`/`bulkDelete` são sobrescritos em `pdv-sales-request-history.service.ts` pra sempre lançar erro — histórico nunca é apagado por ação de negócio, só some via `onDelete: CASCADE` do banco quando a própria solicitação é excluída (o que hoje nem é possível pela API, já que `destroy` do controller de `PdvSalesRequest` retorna 405).

**Escopo atual: só Etapa 1 / Passo A** (estrutura + máquina de estados + vínculo manual de nota de transferência). Passo B (extração por IA do comprovante/DANFE via Gemini) e Etapa 2 (autenticação por link/token sem login, permissões por tela) ainda não existem — ver "Pendências" no fim.

## Schema

`pdv_sales_requests`: `order_id` (FK `orders`, `CASCADE`, sem unique — service impede 2ª solicitação ativa pro mesmo pedido via `findActiveByOrderId`, não é constraint de banco), `unit_business_id` (FK `unit_businesses`, `SET NULL`, espelhado de `order.unit_business_id` na criação, nunca setado via API — existe pra Etapa 2 resolver/filtrar a filial do link sem precisar buscar a order de novo), `sale_invoice_id` (FK `invoices`, `SET NULL`, espelhado de `order.invoice_id` na criação e re-sincronizado no avanço automático pós-NFe — nunca setado via API), `transfer_invoice_id` (FK `invoices`, `SET NULL`, só ADT), `status`/`correction_origin_status` (mesmo enum `PdvSalesRequestStatus`), `shipping_type` (`TRANSPORTADORA`|`ADT`), `name`, `payment_receipt_path`, `errors` (JSONB — `{origin, reasons, note}` da correção mais recente), `created_by_user_id` (nullable, `SET NULL`).

`pdv_sales_request_histories`: `pdv_sales_request_id` (FK, `CASCADE`), `step` (reaproveita literalmente `Object.values(PdvSalesRequestStatus)` — nunca redefinido separado, pra não divergir), `description`, `date`, `user_id` (nullable, `SET NULL`).

Não existe tabela pra "motivos de correção possíveis" — é a constante `CORRECTION_REASONS_BY_ORIGIN` (`pdv-sales-request.types.ts`), indexada por `PdvCorrectionOrigin` (`FINANCE`/`CD21_ANALYSIS`/`EXPEDITION`/`INVOICE_CANCELLED`).

## Máquina de estados (`pdv-sales-request.service.ts`)

Ponto único de escrita de `status`: `transitionTo()` (privado) grava o status e a linha de histórico na mesma transação — nenhum método de negócio escreve `status` fora dele. Fluxo: `OPEN → PENDING_FINANCE → PENDING_CD21_ANALYSIS → PENDING_NF_SALE → (ADT ? PENDING_NF_TRANSFER : SHIPPING) → SHIPPING → FINISHED`.

`PENDING_CORRECTION` é alcançável de `PENDING_FINANCE`/`PENDING_CD21_ANALYSIS`/`SHIPPING` (`correction_origin_status` grava de onde veio). A resolução depende de quem realmente corrige o quê — não é um único endpoint genérico:
- **Origem `PENDING_FINANCE` (comprovante rejeitado)**: `resolveCorrection` recusa explicitamente pedindo pra usar o outro endpoint. Quem resolve é `attachReceiptAndShippingType` — o mesmo método usado na submissão inicial (`OPEN → PENDING_FINANCE`) também aceita ser chamado com a solicitação em `PENDING_CORRECTION` (checando que a origem é `PENDING_FINANCE`), sobe o comprovante novo e reenvia `→ PENDING_FINANCE` sozinho.
- **Origem `PENDING_CD21_ANALYSIS` (dados do pedido)**: o ajuste em si é feito direto na Bling e reflete no pedido via sync — `resolveCorrection` aqui só confirma que a loja corrigiu e manda `→ PENDING_CD21_ANALYSIS` pra reanálise.
- **Origem `SHIPPING` (problema na expedição)**: `resolveCorrection` exige `decision: "CANCEL"|"EXCHANGE_PRODUCT"` (`CANCEL → CANCELLED`; `EXCHANGE_PRODUCT → PENDING_CD21_ANALYSIS`, decisão confirmada com o usuário: troca de produto pode impactar a NF já gerada, por isso reanálise completa em vez de voltar direto pra `SHIPPING`).

`INVOICE_CANCELLED` é o único status alcançável fora do fluxo normal — via `handleInvoiceCancelled(invoiceId)`, chamado por `invoice-xml.ts`/`bling-api-fetch.queue.ts` (ver `.claude/entities/invoice/index.md`) quando a nota de venda ou transferência vinculada é cancelada pela Bling/Tecinco. Não decide sozinho pra onde volta — fica bloqueado até o CD21 decidir via `cd21ResolveInvoiceCancelled(id, { decision })`:
- **`RETRY_ANALYSIS`**: zera `sale_invoice_id`/`transfer_invoice_id` e manda direto `→ PENDING_CD21_ANALYSIS`, repetindo o processo daquele ponto (mesmo helper privado `resetForCd21AnalysisRetry` usado pelo caminho abaixo).
- **`REQUEST_CORRECTION`**: em vez de decidir sozinho, devolve pra loja — grava `correction_origin_status = INVOICE_CANCELLED` e `errors = {origin: PdvCorrectionOrigin.INVOICE_CANCELLED, reasons: [PdvCorrectionReason.INVOICE_CANCELLED], note}`, `→ PENDING_CORRECTION`. A loja resolve depois via `resolveCorrection` com `decision: "CANCEL"` (ela já cancelou o pedido na Bling — vai `→ CANCELLED`) ou `decision: "RETRY_ANALYSIS"` (corrigiu o necessário — mesmo reset + `→ PENDING_CD21_ANALYSIS` do caminho direto do CD21).

## Geração da NF de venda (`PENDING_NF_SALE → próximo status`)

O avanço de `PENDING_NF_SALE` não é um clique de front que muda status diretamente — é automático, disparado pelo sync de pedidos da Bling assim que `order.invoice_id` é (re)confirmado, cobrindo os dois jeitos de gerar a NFe:
- **Pelo sistema**: `POST /:id/sale-invoice/generate` → `pdv-sales-request.service.ts::generateSaleInvoice` (só valida que a solicitação está em `PENDING_NF_SALE`) → `nfeEmissionService.emitForOrder` (`src/modules/handlers/bling/services/bling-nfe/nfe-emission.service.ts`) → `POST /pedidos/vendas/{id}/gerar-nfe` na Bling. Mesma mecânica de chamada que `NFeQueue` (`bling-nfe/nfe.queue.ts`) usa pro pipeline ML, mas sem nenhuma das travas específicas dele (sem filtro de loja Mercado Livre, sem exigir `situacao=NFE_AGENDADA`, sem `NFeValidationService` — que exige `intermediador.cnpj`/`nomeUsuario`, campo de marketplace que pedido de PDV não tem —, sem escalonar pra verificação humana em erro). Única validação: `order.internal_status` não pode estar em `TERMINAL_ORDER_INTERNAL_STATUSES` (`orders.types.ts` — completos + `CANCELLED`); em aberto/em andamento libera.
- **Direto na Bling**: alguém gera manualmente pela interface da Bling; não passa pelo endpoint acima, mas cai no mesmo lugar depois.

Os dois casos convergem no mesmo hook: `bling-order.service.ts` (create e update de pedido) chama `pdvSalesRequestService.markSaleInvoiceReadyIfPending(orderId)` sempre que `resolveInvoiceId` resolve um `invoiceId` não-nulo. Esse método (público) busca a solicitação ativa do pedido e, só se estiver em `PENDING_NF_SALE`, chama o `markSaleInvoiceReady` privado (re-sincroniza `sale_invoice_id` com `order.invoice_id` e transiciona pra `PENDING_NF_TRANSFER` se ADT, senão `SHIPPING`) — silenciosamente no-op pra qualquer outro pedido (a maioria dos pedidos sincronizados não é do fluxo PDV).

## Nota de transferência (`attachTransferInvoice`)

Três formas de vincular, nesta ordem de prioridade: (1) `invoiceId` — o front já resolveu via `searchTransferInvoiceCandidates` (busca local por `number_system`/`id_system`, só leitura, não dispara nada na Tecinco); (2) `xmlBuffer` — chama `TCarUpsertQueue.upsertInvoiceFromXml(xmlContent, branchId)` (método já existente, valida contra a API da Tecinco pela chave de acesso e upserta local), depois localiza a invoice recém-upsertada por `xml_key` (extraído localmente via `shared/utils/xml/access-key.ts`, regex simples — não usa `extractInvoiceIdentificationFromXml` de `invoice-xml.ts` de propósito, pra evitar import circular já que `invoice-xml.ts` chama este service no hook de cancelamento); (3) `danfeBuffer` — extrai a chave de 44 dígitos via `helpers/danfe-interpreter.ts` (`pdf-parse` + regex, só funciona com PDF nativo/texto selecionável) e busca local por `xml_key`. **Não existe fluxo de busca on-demand na API da Tecinco por chave/número** — se a nota não estiver localmente e não vier XML, o método falha pedindo o XML (a Tecinco não expõe esse endpoint; só o upload de XML valida contra a API).

`branchId` (necessário pro `upsertInvoiceFromXml`) é resolvido via `request.unit_business_id → UnitBusiness.number` (direto da coluna denormalizada na própria solicitação, não busca a order de novo), não via usuário logado (`resolveTecincoBranchId` genérico depende de `userId`, que este módulo não tem garantido).

## Rotas e auth

`pdv-sales-request.controller.ts` **não usa `authenticate`/`userPermissions`** — decisão explícita do usuário, o controle de acesso deste módulo é só via token de link (Etapa 2, não implementada). Rotas hoje ficam **sem proteção nenhuma** — pendência bloqueante antes de produção, não esquecimento. `update`/`destroy`/`bulkCreate`/`bulkUpdate`/`bulkDestroy` (genéricos do `BaseController`) são sobrescritos pra retornar 405 — mudar status só pelos endpoints de transição dedicados, nunca por PUT genérico (senão pula a máquina de estados e o histórico).

## Pendências (Passo B / Etapa 2 — não implementadas)
- Extração por IA (Gemini) do comprovante (schema fixo de campos, validação matemática parcela×valor, fingerprint de duplicidade) e fallback de IA pra DANFE fotografado/escaneado — hoje `attachReceiptAndShippingType` só salva o arquivo, sem análise; `attachTransferInvoice` com `danfeBuffer` só funciona com PDF de texto nativo.
- Comparação forma de pagamento (`orders.payment_method_id`) × comprovante — depende da extração acima.
- Autenticação por link/token sem login (loja/financeiro/televendas) e permissões por tela.
