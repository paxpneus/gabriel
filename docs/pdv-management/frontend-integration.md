# PDV Management — Integração Front-end

Documento de referência pra integrar com a API do módulo PDV Management
(`/api/sales-request`, `/api/pdv-access`). Cobre contexto, fluxo, perfis de
acesso, autenticação e todas as rotas/tipos. Mantenha este arquivo batendo
com o código — atualize junto de qualquer mudança de rota/contrato.

## 1. O que é o módulo

Loja digita um pedido na Bling manualmente (venda de balcão/PDV) e precisa
que o Financeiro confira o pagamento e o CD21 (centro de distribuição)
gere as notas fiscais e expeça. Este módulo acompanha esse pedido do
início ao fim: `Loja → Financeiro → CD21 → Expedição`.

Cada pedido tem **uma solicitação** (`PdvSalesRequest`) que anda por uma
máquina de estados. O front nunca muda o status diretamente — sempre por
um endpoint de transição específico (aprovar, rejeitar, confirmar, etc).

## 2. Fluxo (status)

```
OPEN → PENDING_FINANCE → PENDING_CD21_ANALYSIS → PENDING_NF_SALE
                                                        │
                                    ┌───────────────────┘
                                    ▼
                    shipping_type = ADT ? PENDING_NF_TRANSFER : SHIPPING
                                    │
                                    ▼
                                SHIPPING → FINISHED
```

`SHIPPING → FINISHED` acontece por **clique manual do CD21** (`POST
/:id/finish`) **ou sozinho**, assim que o romaneio da nota é gerado —
ver seção 9.

`PENDING_CORRECTION` é alcançável de `PENDING_FINANCE`, `PENDING_CD21_ANALYSIS`,
`SHIPPING` **e também de `FINISHED`** (correção pós-finalização, seção 9) —
a loja resolve, mas o jeito de resolver muda conforme
`correction_origin_status` (ver seção 6). `INVOICE_CANCELLED` é alcançável
a qualquer momento se a nota vinculada for cancelada na Bling/Tecinco —
foge do fluxo normal (seção 7). `CANCELLED` também é alcançável fora do
fluxo normal, sozinho, se o **pedido** (não a nota) for cancelado na Bling
(seção 8).

| Status | Significado | Quem tira daqui |
|---|---|---|
| `OPEN` | Sem comprovante e/ou tipo de envio | Loja |
| `PENDING_FINANCE` | Aguardando aprovação do comprovante | Financeiro |
| `PENDING_CORRECTION` | Devolvido pra loja corrigir algo | Loja |
| `PENDING_CD21_ANALYSIS` | Aguardando conferência do pedido | CD21 |
| `PENDING_NF_SALE` | Aguardando NF de Venda (Bling) | Automático (sync Bling) |
| `PENDING_NF_TRANSFER` | Aguardando NF de Transferência (Tecinco) — só ADT | CD21 |
| `SHIPPING` | Pendente expedição/romaneio | CD21 ou automático (romaneio gerado, seção 9) |
| `FINISHED` | Concluído | — (mas pode ser reaberto pelo CD21, seção 9) |
| `CANCELLED` | Pedido cancelado | — |
| `INVOICE_CANCELLED` | Nota vinculada foi cancelada na origem | CD21 |

**Duas notas, origens diferentes:**

| | NF de Venda | NF de Transferência |
|---|---|---|
| Obrigatória | Sempre | Só `shipping_type = ADT` |
| Origem | Bling | Tecinco |
| Vínculo | Automático (sync Bling) | Manual (loja/CD21 anexa XML/DANFE ou digita) |
| Campo | `sale_invoice_id` | `transfer_invoice_id` |

## 3. Perfis de acesso (telas)

Existem **3 telas** (`screen`) no back. Cada perfil de usuário mapeia pra
uma ou mais:

| Perfil | Tela | O que faz |
|---|---|---|
| **Loja — Operação** | `STORE_REQUEST` | Cria solicitação, anexa comprovante + tipo de envio, resolve correção |
| **Financeiro** | `FINANCE` | Aprova/rejeita comprovante — vê e age sobre pedido de **qualquer loja física normal** (acesso global, sem escopo, um único link/token — não varia por loja) |
| **Televendas** | `STORE_REQUEST` | Igual Loja — Operação, mas sem escolher loja nenhuma: acesso global, vê pedido de **qualquer loja física normal** de uma vez (mesmo mecanismo de Financeiro) |
| **CD21 — Operação** | `CD21` | Analisa pedido, gera/vincula notas, expede, resolve nota cancelada. Vê e age sobre pedido de **qualquer loja** (hub central, sem escopo) |

Uma tela só enxerga/edita a solicitação da própria loja — **exceto CD21,
Financeiro e Televendas**, que não têm escopo de loja nenhum (veem/agem
sobre pedido de qualquer loja). Financeiro/Televendas/CD21, quando listam
sem filtrar por loja, enxergam **lojas físicas normais** (número 1-24,
nunca lojas online/marketplace) — CD21 (loja 21) fica de fora dessa
listagem "todas as lojas" por decisão de produto (era a regra de "Televendas
nunca acessa CD21", generalizada pro conceito de "loja normal").

**Lojas 12 e 17 não participam do fluxo do PDV Management** (decisão de
produto, junto com a CD21/21 acima) — nenhuma das duas nunca tem pedido
elegível (`GET /orders/eligible`, mesmo pedindo a loja explicitamente por
número/token/login) nem `storeRequestUrl` (seção 10). Se alguém pedir o
link de uma dessas 3 lojas explicitamente via `GET /api/pdv-access/links?
unitBusinessId=<id>`, a resposta é erro (`400`, "Loja não participa do
fluxo do PDV Management" — ver seção 12), não um link inválido/vazio.

## 4. Autenticação

**Nenhuma rota exige login.** Toda rota aceita **duas formas alternativas**
de acesso — o front usa uma ou outra, o back tenta as duas:

### 4.0 Fluxo de quem abre o link (sem login)

**Não tem etapa prévia.** Não existe login, troca de token, nem "ativar o
link" antes de usar. A pessoa abre a URL que recebeu (ela já vem com loja
e token embutidos), o front:

1. Lê loja e token da própria URL (rota interna do front, formato livre).
2. Guarda os dois (variável em memória/contexto da sessão — não precisa
   persistir em disco). **A URL sempre vence**: se `number`/`token` estão
   presentes na URL, sobrescreve o que já estiver guardado — nunca só "usa a
   URL se ainda não tinha nada salvo". Sem isso, uma pessoa que já acessou a
   loja A e recebe um link novo pra loja B fica presa na loja A na mesma aba,
   porque o valor antigo nunca é substituído.
3. Manda os 2 headers da seção 4.1 em **toda** chamada pra
   `/api/sales-request/*` a partir daí. Pronto — já pode criar solicitação,
   aprovar, etc.

`GET /api/pdv-access/*` (seção 10) **não faz parte desse fluxo** — é o
caminho contrário: serve pra alguém que **já tem acesso** (por login, ou
por outro link) consultar/gerar o token de uma loja **pra entregar o link
pra outra pessoa**. Quem já recebeu o link pronto nunca precisa chamar
`/api/pdv-access`.

### 4.1 Sem login (link/token) — Loja, Financeiro, Televendas, CD21

Loja/CD21 mandam 2 headers; **Financeiro e Televendas mandam só o token**
(nenhum dos dois tem loja pra informar):

```
x-pdv-unit-business-number: <número da loja>   # Financeiro/Televendas: omitir
x-pdv-token: <token>
```

- `token` é fixo por (loja, tela) e **não expira**. Foi copiado da URL do
  link que a pessoa recebeu, ou obtido via `GET /api/pdv-access/...`
  (seção 10).
- Financeiro e Televendas usam token fixo (`computeFinanceToken`/
  `computeTelesalesToken`, não amarrado a loja nenhuma) e **não selecionam
  loja nenhuma** — o token sozinho já dá acesso a pedidos de todas as lojas
  físicas normais (número 1-24, nunca online/marketplace, e sem a CD21 —
  ver seção 3). `x-pdv-unit-business-number` é ignorado/desnecessário pros
  dois.
- Token errado/faltando → `401`. Loja não encontrada pelo número → `404`.
  `x-pdv-token` faltando → `400` (`x-pdv-unit-business-number` só é exigido
  quando o token não bate com o de Financeiro nem de Televendas).

### 4.2 Com login (usuário logado normalmente no sistema)

Se o browser já tem o cookie `token` de sessão (login normal do sistema),
os headers acima **não são necessários** — o back resolve pela loja atual
do usuário + permissão da role dele. Login tem prioridade: se bater, os
headers de link nem são olhados.

Regra de tela por login:

| Loja atual do usuário | Telas possíveis (se a role permitir) |
|---|---|
| CD21 | `CD21` e/ou `FINANCE` |
| Qualquer outra | `STORE_REQUEST` e/ou `FINANCE` |

`FINANCE` é global — não importa a loja atual do usuário logado, a
permissão sozinha já libera acesso a pedidos de qualquer loja (mesmo
comportamento do acesso por link, seção 4.1).

Permissões de role: `pdv_sales_request_store`, `pdv_sales_request_finance`,
`pdv_sales_request_cd21` (uma flag por tela, concedida na tela de roles).

**Resumo pro front**: se o usuário está numa sessão logada normal, não
precisa mandar nada extra — os requests já saem autenticados pelo cookie
padrão do sistema. Se é acesso por link (usuário não logado), manda os 2
headers acima em toda chamada pra `/api/sales-request/*`.

### 4.3 Websocket — análise assíncrona do comprovante

A extração por IA do comprovante não roda mais dentro de `POST /:id/receipt`
(ver seção 5.2) — ela demora e travava a resposta por até ~1 minuto com
várias lojas subindo comprovante ao mesmo tempo. Agora o endpoint responde
na hora e o resultado da análise chega depois, por websocket.

**Conectar** (namespace próprio, socket.io):

```js
const socket = io(`${API_URL}/pdv`, {
  withCredentials: true, // manda o cookie de sessão, se tiver (login)
  auth: {
    // só se for acesso por link (mesmos valores dos headers da seção 4.1) —
    // omita esses dois campos se for sessão logada
    unitBusinessNumber: "<número da loja>",
    token: "<token>",
  },
});
```

A mesma auth dual da seção 4: se o cookie de login bater, usa ele; senão,
tenta `unitBusinessNumber`/`token` do `auth`. Conexão recusada (`connect_error`)
se nenhum dos dois validar.

**Entrar na "sala" da solicitação** — depois de anexar o comprovante
(`POST /:id/receipt`, que já devolve o `id`), emite:

```js
socket.emit("pdv-sales-request:watch", { requestId: id }, (ack) => {
  // ack: { ok: true } ou { ok: false, error: "..." } (ex.: solicitação não é da sua loja)
});
```

**Escutar o resultado**:

```js
socket.on("payment-receipt-analysis:done", (payload) => {
  // payload.requestId === id da solicitação
});
```

Formato do `payload`:
- Sucesso (inclusive quando a IA não conseguiu extrair nada, ou demorou
  demais — conta como sucesso, só sem dado, igual sempre foi
  `payment_receipt_analysis: null`):
  `{ requestId, success: true, analysis: PaymentReceiptExtraction | null, validated: boolean | null, paymentMethodMatchesReceipt: boolean | null }`.
  `analysis: null` aqui é o sinal pra mostrar "Extração automática indisponível
  — revise o comprovante manualmente antes de enviar" (mesma mensagem de sempre).
- Falha — só 2 casos, **o comprovante continua anexado nos dois**:
  `{ requestId, success: false, reason: "DUPLICATE_RECEIPT", message }` (esse
  comprovante já foi usado em outra solicitação — peça pra trocar) ou
  `{ requestId, success: false, reason: "ANALYSIS_UNAVAILABLE", message }`
  (erro inesperado, raro).

**Prazo máximo pra esse evento chegar: ~5 segundos** do momento em que
`POST /:id/receipt` respondeu — se a IA estiver lenta/sobrecarregada, o back
desiste e manda `success: true, analysis: null` nesse teto, em vez de deixar
o front esperando indefinidamente. Front não precisa de timeout próprio pra
esse evento; se não chegar em ~5-10s (margem de rede), trate como se tivesse
chegado `analysis: null`.

### 4.4 Websocket — sync do Kanban em tempo real

Mesmo socket/namespace da seção 4.3 (`${API_URL}/pdv`, mesma conexão —
**não abra um segundo socket**). Cobre 3 gatilhos: mudança de status de uma
solicitação (inclusive criação), mudança de status de um pedido, e pedido
novo entrando (pipeline Bling → sistema).

**Nenhum evento próprio de "watch" é necessário** — ao conectar, o back já
coloca o socket na "sala" da loja do próprio acesso (login ou link, mesmo
`unitBusinessId`/CD21 resolvido na auth da seção 4). Basta escutar:

```js
socket.on("pdv-store:sync", (payload) => {
  // payload: { unitBusinessId, event }
  // event: "SALES_REQUEST_STATUS_CHANGED" | "ORDER_STATUS_CHANGED" | "NEW_ORDER"
  refetchKanban(); // sempre um refetch simples — nenhum dado de negócio vem no payload
});
```

O evento é **só um sinal pra buscar de novo** — não carrega o registro
atualizado (nem `event` muda o que o front faz: os 3 casos pedem o mesmo
refetch). Recomendado aplicar debounce (~300–500ms) no listener antes de
disparar o fetch: mudanças em sequência (ex.: várias lojas atualizando ao
mesmo tempo, ou um pedido passando por 2 status seguidos) podem gerar mais
de um evento em poucos segundos.

Tela `CD21` recebe o evento de **qualquer loja** (acesso global, mesmo
scoping das rotas HTTP da seção 3) — as outras telas só da própria loja.

## 5. Rotas — `/api/sales-request`

Base: `/api/sales-request`. Todas retornam `{ error: string }` com status
de erro em caso de falha.

### 5.1 Leitura (telas: `STORE_REQUEST` | `FINANCE` | `CD21`)

| Método | Rota | Query params | Resposta |
|---|---|---|---|
| GET | `/` | `page`, `perPage`, `sortBy`, `sortDir`, `filters[status]`, `filters[shipping_type]`, `filters[unit_business_id]`, `filters[order_id]` | `PaginatedResult<PdvSalesRequest & { order: PdvSalesRequestOrderSummary \| null; unitBusiness: PdvSalesRequestUnitBusiness \| null; saleInvoice: PdvSalesRequestInvoiceSummary \| null; transferInvoice: PdvSalesRequestInvoiceSummary \| null }>` — default `sortBy=createdAt&sortDir=ASC` (mais antigo primeiro, fila FIFO), sobrescrevível via query string |
| GET | `/:id` | — | `PdvSalesRequest & { order: PdvSalesRequestOrderDetail \| null; unitBusiness: PdvSalesRequestUnitBusiness \| null; saleInvoice: PdvSalesRequestInvoiceSummary \| null; transferInvoice: PdvSalesRequestInvoiceSummary \| null }` (404 se não for da sua loja, exceto CD21/Financeiro/Televendas) |
| GET | `/:id/history` | — | `PdvSalesRequestHistory[]` — ordenado por `date DESC` (mais recente primeiro, fixo, não aceita `sortBy`/`sortDir`) |
| GET | `/:id/invoice/:invoiceId/danfe` | — | `200` binário `application/pdf` — DANFE da nota de venda ou de transferência vinculada (`invoiceId` = `saleInvoice.id` ou `transferInvoice.id` da própria solicitação; `400` se não bater com nenhuma das duas) |

Loja só vê solicitação da própria loja (escopo automático, não precisa
mandar `filters[unit_business_id]`). CD21/Financeiro/Televendas, sem
`filters[unit_business_id]`, veem de **todas as lojas físicas normais**
(número 1-24, nunca online/marketplace, sem a CD21) — podem usar
`filters[unit_business_id]` pra restringir a uma loja específica se
quiserem.

`order` é montado on-the-fly a partir de `order_id` (join com Bling `orders`
+ `customers`/`unit_businesses`/`payment_methods`/`order_items`) — nunca
persistido na própria tabela `pdv_sales_requests`. Vem `null` só se o
pedido tiver sido excluído (não deveria acontecer em uso normal). A
listagem (`GET /`) traz a versão resumida (`PdvSalesRequestOrderSummary`,
sem forma de pagamento/parcelas/itens — o card reduzido do Kanban não
precisa disso); o detalhe (`GET /:id`) traz a versão completa
(`PdvSalesRequestOrderDetail`), com `installments` derivado de
`order.source_payload.parcelas.length` (não é coluna própria — a Bling não
expõe parcelas como campo estruturado, só dentro do payload cru, que o
back nunca repassa ao front). Ver os dois tipos na seção 11.

`unitBusiness` (sibling de `order`, no topo da resposta) é a loja da
PRÓPRIA solicitação (`unit_business_id`), não a loja aninhada dentro de
`order` — só `{ id, number }`, sem `name`. Útil quando o front só precisa
identificar a loja sem entrar no objeto `order`.

`saleInvoice`/`transferInvoice` (siblings de `order`/`unitBusiness`) só
`{ id, number_system }` — `null` enquanto a respectiva nota ainda não foi
vinculada/gerada. Front usa `number_system` pra exibir o número da nota no
card e `id` pra montar `GET /:id/invoice/:invoiceId/danfe` (botão "Visualizar
DANFE", um par por tipo de nota quando aplicável).

### 5.2 Loja — Operação (`STORE_REQUEST`)

| Método | Rota | Body | Resposta |
|---|---|---|---|
| GET | `/orders/eligible` | — | `PdvSalesRequestOrderSummary[]` — pedidos da loja do acesso (Televendas: de **todas** as lojas físicas normais de uma vez, sem escolher loja), sem status finalizador (completo/cancelado) e sem solicitação PDV ativa ainda (coluna "Em Aberto" do Kanban, ação "Criar solicitação"), ordenado por `date ASC` (mais antigo primeiro, fixo) |
| GET | `/orders/:orderId` | — | `PdvSalesRequestOrderDetail` (404 se não existir ou não for da loja do acesso) — card expandido de um pedido de `/orders/eligible`, antes de existir solicitação |
| POST | `/` | `{ orderId: string, name: string }` | `201 PdvSalesRequest` |
| POST | `/:id/receipt` | multipart: campo `receipt` (arquivo) + campo `shippingType: "TRANSPORTADORA" \| "ADT"` | `202 PdvSalesRequest & { paymentReceiptAnalysisStatus: "PROCESSING" }` |
| PATCH | `/:id/receipt/analysis` | `Partial<PaymentReceiptExtraction>` (só os campos que mudaram) | `PdvSalesRequest` |
| POST | `/:id/receipt/confirm` | — | `PdvSalesRequest` (avança pra `PENDING_FINANCE`) |
| POST | `/:id/correction/resolve` | `{ decision?: "CANCEL" \| "EXCHANGE_PRODUCT" \| "RETRY_ANALYSIS" }` — ver seção 6 | `PdvSalesRequest` |
| DELETE | `/:id` | — | `204` (404 se não for da sua loja) |

- `DELETE /:id` — só permitido com `status` em `OPEN` ou `PENDING_CORRECTION`
  (ainda não saiu do lugar, ou foi devolvida pra loja corrigir). Qualquer
  outro status responde `405 { "error": "Exclusão não é permitida — resolva
  pelo fluxo de correção/cancelamento." }` — a partir daí já existe
  pedido/nota em andamento no fluxo, resolve cancelando (seção 6) em vez de
  apagar.
- `GET /orders/eligible` — elegibilidade: `order.unit_business_id` igual à
  loja do acesso (pedido de canal de marketplace, ex. Mercado Livre, nunca
  tem isso preenchido — já sai de fora sozinho) e sem `PdvSalesRequest`
  ativa pra esse `order_id` ainda (mesma noção de "ativa" de `errors`/status
  terminal — um pedido cuja última solicitação já terminou pode gerar outra
  nova). Sem paginação por enquanto (`limit` interno de 200, sem filtro de
  data) — revisar se a lista crescer demais na prática. **Lojas 21 (CD21),
  12 e 17 nunca retornam nada aqui** (array vazio, não erro) — não
  participam do fluxo do PDV, mesmo que a loja do acesso seja uma dessas 3
  explicitamente (não só no agregado "todas as lojas" de Financeiro/
  Televendas/CD21).
- `POST /` — `orderId` precisa ser um pedido da **mesma loja** do acesso
  (número do header/loja atual do login), senão `403`.
- `POST /:id/receipt` pode ser chamado várias vezes (troca de comprovante)
  antes de confirmar — não muda status. Responde **`202`** na hora, com
  `payment_receipt_analysis` sempre `null` nesse ponto (zerado de propósito)
  e `paymentReceiptAnalysisStatus: "PROCESSING"` — a extração roda em
  background, resultado chega pelo websocket (seção 4.3), nunca por essa
  resposta. Front deve conectar/entrar na room ANTES ou logo depois de
  chamar esse endpoint, senão pode perder o evento se ele chegar rápido.
- `PATCH /:id/receipt/analysis` deixa a loja corrigir campo a campo a
  análise extraída pela IA antes de confirmar (ex.: a IA leu o apelido da
  maquininha em `instituicao_pagamento` errado, ou não bateu o
  `estabelecimento_cnpj`) — manda só os campos que mudaram, o resto da
  análise atual é preservado (merge, nunca substitui o objeto inteiro).
  Precisa de um comprovante já anexado (`POST /:id/receipt` primeiro), e só
  funciona na mesma janela de edição do comprovante (antes de confirmar, ou
  numa correção de origem financeiro). Resposta já vem com
  `payment_receipt_validated`/`payment_receipt_fingerprint`/
  `payment_method_matches_receipt` recalculados a partir da análise
  editada — inclusive a checagem de comprovante duplicado (`400` se a
  edição fizer a análise colidir com outra solicitação). Só chame depois de
  receber `payment-receipt-analysis:done` pelo websocket (seção 4.3) — editar
  antes disso corre o risco de a análise assíncrona ainda em andamento
  sobrescrever a edição manual quando terminar.
- Só `POST /:id/receipt/confirm` avança o status — exige que já exista
  `payment_receipt_path` e `shipping_type` salvos.

### 5.3 Financeiro (`FINANCE`) — acesso global, qualquer loja

| Método | Rota | Body | Resposta |
|---|---|---|---|
| POST | `/:id/finance/approve` | — | `PdvSalesRequest` (avança pra `PENDING_CD21_ANALYSIS`) |
| POST | `/:id/finance/reject` | `{ note: string }` | `PdvSalesRequest` (vai pra `PENDING_CORRECTION`) |

### 5.4 CD21 — Operação (`CD21`)

| Método | Rota | Body | Resposta |
|---|---|---|---|
| POST | `/:id/cd21-analysis/approve` | — | `PdvSalesRequest` (avança pra `PENDING_NF_SALE`) |
| POST | `/:id/cd21-analysis/reject` | `{ reasons: PdvCorrectionReason[], note: string }` | `PdvSalesRequest` (vai pra `PENDING_CORRECTION`) |
| POST | `/:id/sale-invoice/generate` | — | `PdvSalesRequest` (dispara emissão na Bling; status muda depois, sozinho, quando o sync confirmar a NFe) |
| GET | `/transfer-invoice/search?q=` | — | `InvoiceCandidate[]` (autocomplete, busca local por número/id da nota) |
| POST | `/:id/transfer-invoice` | `{ invoiceId: string }` **ou** multipart `xml`/`danfe` | `PdvSalesRequest` (vincula, não avança status sozinho) |
| POST | `/:id/transfer-invoice/confirm` | — | `PdvSalesRequest` (avança pra `SHIPPING`, exige nota já vinculada) |
| GET | `/:id/transfer-invoice/editable` | — | `{ editable: boolean }` — chame antes de mostrar o componente de troca (ver abaixo) |
| POST | `/:id/expedition/reject` | `{ reasons: PdvCorrectionReason[], note: string }` | `PdvSalesRequest` (vai pra `PENDING_CORRECTION`) |
| POST | `/:id/finish` | — | `PdvSalesRequest` (avança pra `FINISHED`) — normalmente nem precisa ser chamado: acontece sozinho quando o romaneio é gerado, ver seção 9 |
| POST | `/:id/invoice-cancelled/resolve` | `{ decision: "RETRY_ANALYSIS" \| "REQUEST_CORRECTION", note?: string }` | `PdvSalesRequest` — ver seção 7 |
| POST | `/:id/correction/finished` (`correctFinishedRequest`) | `{ decision: "REQUEST_CORRECTION" \| "RESET_INVOICES", reasons?: PdvCorrectionReason[], note?: string }` | `PdvSalesRequest` — reabre uma solicitação já `FINISHED`, ver seção 9 |

`POST /:id/transfer-invoice` — manda **um dos três**: `invoiceId` (nota já
existente, ver autocomplete acima), `xml` (valida contra a Tecinco e já
cadastra a nota), ou `danfe` (extrai a chave e busca localmente — se a nota
ainda não existir no sistema, pede pra mandar o XML em vez disso).

Aceito com a solicitação em `PENDING_NF_TRANSFER`, `SHIPPING` **ou
`FINISHED`** — em `FINISHED` é a forma de reabrir só pra corrigir a nota de
transferência sem passar por `correction/finished` (que muda status): o
`status` não muda, só o `transfer_invoice_id`. Em `SHIPPING`/`FINISHED` a
troca só é aceita se o romaneio da nota de **venda** ainda não tiver sido
gerado — depois de gerado, `400 { "error": "Não é possível trocar a nota de
transferência — o romaneio da nota de venda já foi gerado" }`.

`GET /:id/transfer-invoice/editable` existe pra evitar chamar `POST
/:id/transfer-invoice` só pra descobrir se toma esse 400 — devolve
`{ editable: boolean }` já considerando as duas condições (status elegível +
romaneio da venda ainda não gerado, se aplicável). Use pra decidir se mostra
o componente de troca de nota de transferência: chame com o card em
`PENDING_NF_TRANSFER`, `SHIPPING` ou `FINISHED` (nos outros status já dá
`false` sem nem checar romaneio); em qualquer outro status nem precisa
chamar, o componente não aparece.

`InvoiceCandidate`:
```ts
{ id: string; number_system: string; id_system: string; xml_key: string; receiver_name: string; emitted_at: string }
```

## 6. Correção (`PENDING_CORRECTION`)

Quando a solicitação cai em `PENDING_CORRECTION`, o campo `errors` explica
o quê:

```ts
{ origin: PdvCorrectionOrigin; reasons: PdvCorrectionReason[]; note: string }
```

`correction_origin_status` guarda de onde veio (`PENDING_FINANCE`,
`PENDING_CD21_ANALYSIS`, `SHIPPING`, `INVOICE_CANCELLED` ou `FINISHED`) —
o front usa pra decidir **como** a loja resolve. Motivos disponíveis por
origem (pra montar checklist na tela de "devolver pra correção", usado
pelo Financeiro/CD21/Expedição):

| Origem (`PdvCorrectionOrigin`) | Quem devolve | Motivos (`PdvCorrectionReason`) |
|---|---|---|
| `FINANCE` | Financeiro | `PAYMENT_RECEIPT` (só esse) |
| `CD21_ANALYSIS` | CD21 — Análise | `CUSTOMER_NAME`, `CUSTOMER_DOCUMENT`, `PAYMENT_METHOD`, `INSTALLMENTS`, `SHIPPING_TYPE`, `ORDER_NUMBER`, `ORDER_DATE`, `TOTAL_VALUE`, `DISCOUNT_VALUE`, `BLING_PDF`, `PAYMENT_RECEIPT`, `OTHER_INFO` |
| `EXPEDITION` | CD21 — Expedição | `PRODUCT_UNAVAILABLE`, `ITEM_DIVERGENCE`, `DAMAGED_PRODUCT`, `OTHER_INFO` |
| `INVOICE_CANCELLED` | CD21 (automático, seção 7) | `INVOICE_CANCELLED` (só esse) |
| `FINISHED` | CD21 (`POST /:id/correction/finished`, seção 9) | `PRODUCT_UNAVAILABLE`, `ITEM_DIVERGENCE`, `DAMAGED_PRODUCT`, `OTHER_INFO` |

Como a loja resolve cada origem:

| `correction_origin_status` | Endpoint que resolve | Detalhe |
|---|---|---|
| `PENDING_FINANCE` | `POST /:id/receipt` + `POST /:id/receipt/confirm` | **Não** usa `/correction/resolve` — troca o comprovante e confirma de novo, mesmo fluxo da seção 5.2 |
| `PENDING_CD21_ANALYSIS` | `POST /:id/correction/resolve` sem `decision` | Ajuste é feito direto na Bling (fora do sistema); este endpoint só confirma e reenvia pra `PENDING_CD21_ANALYSIS` |
| `SHIPPING` | `POST /:id/correction/resolve` com `decision: "CANCEL" \| "EXCHANGE_PRODUCT"` | `CANCEL` → `CANCELLED`. `EXCHANGE_PRODUCT` → `PENDING_CD21_ANALYSIS` (reanálise completa, pode impactar a nota já gerada) |
| `INVOICE_CANCELLED` | `POST /:id/correction/resolve` com `decision: "CANCEL" \| "RETRY_ANALYSIS"` | Ver seção 7 |
| `FINISHED` | `POST /:id/correction/resolve` sem `decision` | Ajuste é feito fora do sistema (ex.: fisicamente); este endpoint só confirma e volta **direto pra `FINISHED`** (não passa por `SHIPPING` de novo) — ver seção 9 |

## 7. Nota fiscal cancelada (`INVOICE_CANCELLED`)

Se a NF de venda ou de transferência vinculada for cancelada na
Bling/Tecinco, o back muda o status pra `INVOICE_CANCELLED` sozinho (via
sync, sem ação do front). CD21 decide o desfecho:

`POST /:id/invoice-cancelled/resolve` — `{ decision: "RETRY_ANALYSIS" | "REQUEST_CORRECTION", note?: string }`

- `RETRY_ANALYSIS` — zera as notas vinculadas, volta direto pra
  `PENDING_CD21_ANALYSIS`.
- `REQUEST_CORRECTION` — devolve pra loja (`PENDING_CORRECTION`,
  `correction_origin_status = INVOICE_CANCELLED`) — loja resolve pela
  tabela da seção 6.

## 8. Pedido cancelado na Bling

Diferente da seção 7 (nota cancelada): se o **pedido** em si for cancelado
na Bling — não a nota, o pedido — qualquer solicitação PDV ativa pra ele
vai **direto pra `CANCELLED`**, sozinho, sem passar por `INVOICE_CANCELLED`
e sem decisão nenhuma do CD21. Não existe endpoint aqui — é 100% automático,
disparado pelo sync de pedidos da Bling. Uma solicitação já `FINISHED` não é
afetada por um cancelamento tardio do pedido.

## 9. Finalização automática (romaneio) e correção pós-`FINISHED`

### 9.1 Auto-finish

`finish` (`POST /:id/finish`, seção 5.4) continua existindo pra clique
manual, mas na prática a solicitação normalmente se finaliza **sozinha**
assim que o romaneio da nota é gerado no CD21 (tela de expedição, fora
deste módulo). Critério de prontidão depende de `shipping_type`:

- `TRANSPORTADORA` — não tem nota de transferência, então basta o romaneio
  da NF de Venda ser gerado.
- `ADT` — só finaliza quando o romaneio de **AMBAS** as notas (Venda e
  Transferência) já foi gerado. As duas podem entrar em romaneios
  diferentes, em momentos diferentes — nunca finaliza com uma pendente.

Front não precisa fazer nada especial pra isso: se a tela de detalhe
estiver com polling/websocket, `status` muda pra `FINISHED` sozinho quando
o critério acima for satisfeito. `POST /:id/finish` manual continua
disponível como fallback, mas só funciona a partir de `SHIPPING`.

### 9.2 Correção pós-`FINISHED`

`FINISHED` não é 100% definitivo — o CD21 pode reabrir uma solicitação já
finalizada:

`POST /:id/correction/finished` (`PdvSalesRequestService.correctFinishedRequest`) — `{ decision: "REQUEST_CORRECTION" | "RESET_INVOICES", reasons?: PdvCorrectionReason[], note?: string }`

- **`REQUEST_CORRECTION`** (padrão/mais comum) — não mexe nas notas.
  `note` é **obrigatório**; `reasons` é opcional (default `[OTHER_INFO]` se
  omitido). Vai pra `PENDING_CORRECTION` com `correction_origin_status =
  FINISHED` e `errors` preenchido (mesmo formato da seção 6, motivos
  disponíveis na tabela lá). A loja resolve confirmando por
  `POST /:id/correction/resolve` **sem** `decision` — volta direto pra
  `FINISHED` (não passa por `SHIPPING` de novo).
- **`RESET_INVOICES`** — zera `sale_invoice_id` **e** `transfer_invoice_id`
  e manda direto pra `PENDING_NF_SALE`, refazendo o faturamento do zero
  (as duas notas precisam ser reemitidas, mesmo em `TRANSPORTADORA` onde só
  a de venda existia). Não passa por `PENDING_CD21_ANALYSIS` — os dados do
  pedido não são o problema, só as notas emitidas.

## 10. Obter o link/token de uma tela

Token não fica salvo em lugar nenhum — é derivado. Pra montar/copiar o(s)
link(s) de uma loja (ex.: tela de administração cadastrando uma loja nova),
chame (precisa de acesso a alguma tela, via login ou link):

| Método | Rota | Resposta |
|---|---|---|
| GET | `/api/pdv-access/links?unitBusinessId=<id>` | `{ general, unsupportedUnitBusinessNumbers, store: PdvStoreRequestLink }` — `store` é o link `STORE_REQUEST` dessa loja |
| GET | `/api/pdv-access/links` (sem query) | `{ general, unsupportedUnitBusinessNumbers, stores: PdvStoreRequestLink[] }` — `stores` com uma entrada por loja comercial cadastrada |

`STORE_REQUEST` é a única tela escopada por loja — por isso só ela aparece
em `store`/`stores`, um objeto por loja. `general` (CD21/Financeiro/
Televendas) e `unsupportedUnitBusinessNumbers` vêm **sempre**, calculados uma
única vez, iguais nos dois casos — `general` porque essas 3 telas são acesso
global (o mesmo link/token de sempre não muda por loja nem se repete numa
listagem); `unsupportedUnitBusinessNumbers` porque é metadado fixo, não
depende de qual loja foi consultada.

**Lojas 21 (CD21), 12 e 17 nunca aparecem em `stores`** (listagem completa,
sem query) — não participam do fluxo do PDV (mesma regra da seção 3/5.2).
Pedindo uma delas explicitamente (`?unitBusinessId=<id>` de uma dessas 3),
a resposta é erro em vez de `store`: `400 { "error": "Loja não participa do
fluxo do PDV Management" }`. Pra telas do front que listam unit businesses
por outra via (não por este endpoint), `unsupportedUnitBusinessNumbers`
(`string[]`, sempre `["21", "12", "17"]`) é a mesma lista pronta pra decidir
onde esconder a ação de PDV, sem precisar hardcodar os números no front.

```ts
interface PdvStoreRequestLink {
  unitBusinessId: string;
  unitBusinessNumber: string;
  unitBusinessName: string;
  storeRequestUrl: string;
}

interface PdvGeneralAccessLinks {
  cd21Url: string;
  financeUrl: string;
  telesalesUrl: string;
}
```

Cada `*Url` já é o link completo pronto pra abrir no browser/mandar pra
pessoa — não é mais sugestão, é o contrato fixo. Rota única no front, tela
vem na query string (confirmado testando contra o router real — não é path
por tela):

```
https://hub.paxpneus.com.br/pdv-management?token=<token>&screen=<tela>&number=<número>
```

(`FRONTEND_URL` no ambiente sobrescreve o domínio; `<tela>` é `store_request`
| `finance` | `cd21` | `telesales`). O front lê `number`/`token`/`screen` da
própria URL e manda os dois primeiros como os headers da seção 4.1 em toda
chamada pra `/api/sales-request/*`. `storeRequestUrl`/`cd21Url` sempre vêm
com `number` embutido; `financeUrl`/`telesalesUrl` **nunca** vêm com
`number` — Financeiro não precisa de loja nenhuma (seção 4.1), Televendas
escolhe a loja em tempo de navegação, dentro do front.

## 11. Tipos

```ts
enum PdvSalesRequestStatus {
  OPEN, PENDING_FINANCE, PENDING_CD21_ANALYSIS, PENDING_CORRECTION,
  PENDING_NF_SALE, PENDING_NF_TRANSFER, SHIPPING, FINISHED,
  CANCELLED, INVOICE_CANCELLED,
}

enum PdvShippingType { TRANSPORTADORA, ADT }

enum PdvCorrectionOrigin { FINANCE, CD21_ANALYSIS, EXPEDITION, INVOICE_CANCELLED, FINISHED }

enum PdvCorrectionReason {
  PAYMENT_RECEIPT, CUSTOMER_NAME, CUSTOMER_DOCUMENT, PAYMENT_METHOD,
  INSTALLMENTS, SHIPPING_TYPE, ORDER_NUMBER, ORDER_DATE, TOTAL_VALUE,
  DISCOUNT_VALUE, BLING_PDF, OTHER_INFO, PRODUCT_UNAVAILABLE,
  ITEM_DIVERGENCE, DAMAGED_PRODUCT, INVOICE_CANCELLED,
}

interface PdvSalesRequest {
  id: string;
  order_id: string;
  unit_business_id: string | null;
  sale_invoice_id: string | null;
  transfer_invoice_id: string | null;
  status: PdvSalesRequestStatus;
  correction_origin_status: PdvSalesRequestStatus | null;
  shipping_type: PdvShippingType | null;
  name: string;
  payment_receipt_path: string | null;
  payment_receipt_analysis: PaymentReceiptExtraction | null;
  payment_receipt_validated: boolean | null;   // null = não aplicável (ex.: PIX)
  payment_receipt_fingerprint: string | null;
  payment_method_matches_receipt: boolean | null; // informativo, nunca bloqueia
  errors: { origin: PdvCorrectionOrigin; reasons: PdvCorrectionReason[]; note: string } | null;
  created_by_user_id: string | null;
  createdAt: string;
  updatedAt: string;
}

// Loja da PRÓPRIA solicitação (unit_business_id), embutida no topo da
// resposta de GET / e GET /:id — distinta da loja aninhada em order.
interface PdvSalesRequestUnitBusiness {
  id: string;
  number: string;
}

// saleInvoice/transferInvoice, embutidas no topo de GET / e GET /:id — null
// enquanto a nota ainda não foi vinculada/gerada. id serve pra montar
// GET /:id/invoice/:invoiceId/danfe (seção 5.1).
interface PdvSalesRequestInvoiceSummary {
  id: string;
  number_system: string;
}

interface PdvSalesRequestHistory {
  id: string;
  pdv_sales_request_id: string;
  step: PdvSalesRequestStatus;   // status no momento do evento
  description: string;
  date: string;
  user_id: string | null;        // null = ação anônima (via link)
}

// Schema fixo da extração por IA do comprovante — todo campo nullable
// (null = ilegível/coberto na imagem, a IA nunca inventa valor)
interface PaymentReceiptExtraction {
  tipo_comprovante: "cartao_credito" | "cartao_debito" | "pix" | "transferencia" | null;
  estabelecimento_nome: string | null;
  estabelecimento_cnpj: string | null;
  valor_total: number | null;
  qtd_parcelas: number | null;
  valor_parcela: number | null;
  data_transacao: string | null;
  hora_transacao: string | null;
  bandeira_cartao: string | null;
  // Transcrito literalmente do comprovante — banco/instituição (ex.:
  // "Itaú") OU nome/apelido da maquininha de cartão (ex.: "Laranjinha
  // Itaú"), que nem sempre bate com o nome oficial do banco.
  instituicao_pagamento: string | null;
  titular_cartao: string | null;
  cartao_final: string | null;
  codigo_autorizacao: string | null;
  nsu_cv: string | null;
}

interface PaginatedResult<T> {
  data: T[];
  meta: { total: number; page: number; perPage: number; totalPages: number; hasNext: boolean; hasPrev: boolean };
}

// Pedido (Bling) embutido em GET / e GET /:id — ver seção 5.1. Nunca
// persistido em pdv_sales_requests, sempre resolvido a partir de order_id.
interface PdvSalesRequestOrderSummary {
  id: string;
  number_order_channel: string;
  number_order_system: string | null;
  date: string | null;
  total_order: number | null;
  customer: { id: string; name: string; document: string } | null;
  unitBusiness: { id: string; number: string; name: string } | null;
}

interface PdvSalesRequestOrderDetail extends PdvSalesRequestOrderSummary {
  paymentMethod: { id: string; description: string } | null;
  installments: number | null;   // order.source_payload.parcelas.length — não é coluna própria
  items: { id: string; name: string; sku: string; quantity: number; price: number }[];
}
```

## 12. Erros

| Status | Quando |
|---|---|
| `400` | Header de link faltando, parâmetro obrigatório faltando no body, ou `GET /api/pdv-access/links?unitBusinessId=` de uma loja fora do fluxo PDV (21/CD21, 12, 17) |
| `401` | Token inválido/não bate com a tela da rota, sem login e sem headers |
| `403` | `orderId` de outra loja no `POST /` |
| `404` | Solicitação/loja não encontrada, ou não pertence à loja do acesso |
| `500` | Erro interno (inclui: variável de ambiente do segredo de token não configurada no servidor — reportar pro back, não é algo que o front resolve) |

Toda resposta de erro é `{ "error": "mensagem" }`.
