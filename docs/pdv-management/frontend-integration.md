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

`PENDING_CORRECTION` é alcançável de `PENDING_FINANCE`, `PENDING_CD21_ANALYSIS`
e `SHIPPING` — a loja resolve, mas o jeito de resolver muda conforme
`correction_origin_status` (ver seção 6). `INVOICE_CANCELLED` é alcançável
a qualquer momento se a nota vinculada for cancelada na Bling/Tecinco —
foge do fluxo normal (seção 7).

| Status | Significado | Quem tira daqui |
|---|---|---|
| `OPEN` | Sem comprovante e/ou tipo de envio | Loja |
| `PENDING_FINANCE` | Aguardando aprovação do comprovante | Financeiro |
| `PENDING_CORRECTION` | Devolvido pra loja corrigir algo | Loja |
| `PENDING_CD21_ANALYSIS` | Aguardando conferência do pedido | CD21 |
| `PENDING_NF_SALE` | Aguardando NF de Venda (Bling) | Automático (sync Bling) |
| `PENDING_NF_TRANSFER` | Aguardando NF de Transferência (Tecinco) — só ADT | CD21 |
| `SHIPPING` | Pendente expedição/romaneio | CD21 |
| `FINISHED` | Concluído | — |
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
| **Loja — Financeiro** | `FINANCE` | Aprova/rejeita comprovante da própria loja |
| **Televendas** | `STORE_REQUEST` (dinâmico) | Igual Loja — Operação, mas escolhe a loja a cada acesso. **Nunca acessa a loja CD21** |
| **CD21 — Operação** | `CD21` | Analisa pedido, gera/vincula notas, expede, resolve nota cancelada. Vê e age sobre pedido de **qualquer loja** (hub central, sem escopo) |
| **CD21 — Financeiro** | `FINANCE` (loja = CD21) | Mesma tela/rotas do Financeiro de loja, só que pra pedidos "da loja CD21" — na prática pouco usado, mas o mecanismo é idêntico |

Uma tela só enxerga/edita a solicitação da própria loja — **exceto CD21**,
que não tem escopo de loja nenhum.

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

`GET /api/pdv-access/*` (seção 8) **não faz parte desse fluxo** — é o
caminho contrário: serve pra alguém que **já tem acesso** (por login, ou
por outro link) consultar/gerar o token de uma loja **pra entregar o link
pra outra pessoa**. Quem já recebeu o link pronto nunca precisa chamar
`/api/pdv-access`.

### 4.1 Sem login (link/token) — Loja, Financeiro, Televendas, CD21

Todo request manda 2 headers:

```
x-pdv-unit-business-number: <número da loja>
x-pdv-token: <token>
```

- `token` é fixo por (loja, tela) e **não expira**. Foi copiado da URL do
  link que a pessoa recebeu, ou obtido via `GET /api/pdv-access/...`
  (seção 8).
- Televendas usa o **mesmo token pra qualquer loja** (só muda o número da
  loja no header) — exceto a loja CD21, que é sempre rejeitada (`403`)
  nesse modo.
- Token errado/faltando → `401`. Loja não encontrada pelo número → `404`.
  Faltando algum dos dois headers → `400`.

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

## 5. Rotas — `/api/sales-request`

Base: `/api/sales-request`. Todas retornam `{ error: string }` com status
de erro em caso de falha.

### 5.1 Leitura (telas: `STORE_REQUEST` | `FINANCE` | `CD21`)

| Método | Rota | Query params | Resposta |
|---|---|---|---|
| GET | `/` | `page`, `perPage`, `sortBy`, `sortDir`, `filters[status]`, `filters[shipping_type]`, `filters[unit_business_id]`, `filters[order_id]` | `PaginatedResult<PdvSalesRequest & { order: PdvSalesRequestOrderSummary \| null }>` — default `sortBy=createdAt&sortDir=ASC` (mais antigo primeiro, fila FIFO), sobrescrevível via query string |
| GET | `/:id` | — | `PdvSalesRequest & { order: PdvSalesRequestOrderDetail \| null }` (404 se não for da sua loja, exceto CD21) |
| GET | `/:id/history` | — | `PdvSalesRequestHistory[]` — ordenado por `date DESC` (mais recente primeiro, fixo, não aceita `sortBy`/`sortDir`) |

Loja/Financeiro só veem solicitação da própria loja (escopo automático,
não precisa mandar `filters[unit_business_id]`). CD21 vê tudo — pode usar
`filters[unit_business_id]` pra filtrar por loja se quiser.

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
back nunca repassa ao front). Ver os dois tipos na seção 9.

### 5.2 Loja — Operação (`STORE_REQUEST`)

| Método | Rota | Body | Resposta |
|---|---|---|---|
| GET | `/orders/eligible` | — | `PdvSalesRequestOrderSummary[]` — pedidos da loja do acesso, sem status finalizador (completo/cancelado) e sem solicitação PDV ativa ainda (coluna "Em Aberto" do Kanban, ação "Criar solicitação"), ordenado por `date ASC` (mais antigo primeiro, fixo) |
| GET | `/orders/:orderId` | — | `PdvSalesRequestOrderDetail` (404 se não existir ou não for da loja do acesso) — card expandido de um pedido de `/orders/eligible`, antes de existir solicitação |
| POST | `/` | `{ orderId: string, name: string }` | `201 PdvSalesRequest` |
| POST | `/:id/receipt` | multipart: campo `receipt` (arquivo) + campo `shippingType: "TRANSPORTADORA" \| "ADT"` | `202 PdvSalesRequest & { paymentReceiptAnalysisStatus: "PROCESSING" }` |
| PATCH | `/:id/receipt/analysis` | `Partial<PaymentReceiptExtraction>` (só os campos que mudaram) | `PdvSalesRequest` |
| POST | `/:id/receipt/confirm` | — | `PdvSalesRequest` (avança pra `PENDING_FINANCE`) |
| POST | `/:id/correction/resolve` | `{ decision?: "CANCEL" \| "EXCHANGE_PRODUCT" \| "RETRY_ANALYSIS" }` — ver seção 6 | `PdvSalesRequest` |

- `GET /orders/eligible` — elegibilidade: `order.unit_business_id` igual à
  loja do acesso (pedido de canal de marketplace, ex. Mercado Livre, nunca
  tem isso preenchido — já sai de fora sozinho) e sem `PdvSalesRequest`
  ativa pra esse `order_id` ainda (mesma noção de "ativa" de `errors`/status
  terminal — um pedido cuja última solicitação já terminou pode gerar outra
  nova). Sem paginação por enquanto (`limit` interno de 200, sem filtro de
  data) — revisar se a lista crescer demais na prática.
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

### 5.3 Financeiro (`FINANCE`) — loja ou CD21

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
| POST | `/:id/expedition/reject` | `{ reasons: PdvCorrectionReason[], note: string }` | `PdvSalesRequest` (vai pra `PENDING_CORRECTION`) |
| POST | `/:id/finish` | — | `PdvSalesRequest` (avança pra `FINISHED`) |
| POST | `/:id/invoice-cancelled/resolve` | `{ decision: "RETRY_ANALYSIS" \| "REQUEST_CORRECTION", note?: string }` | `PdvSalesRequest` — ver seção 7 |

`POST /:id/transfer-invoice` — manda **um dos três**: `invoiceId` (nota já
existente, ver autocomplete acima), `xml` (valida contra a Tecinco e já
cadastra a nota), ou `danfe` (extrai a chave e busca localmente — se a nota
ainda não existir no sistema, pede pra mandar o XML em vez disso).

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
`PENDING_CD21_ANALYSIS` ou `SHIPPING`) — o front usa pra decidir **como**
a loja resolve. Motivos disponíveis por origem (pra montar checklist na
tela de "devolver pra correção", usado pelo Financeiro/CD21/Expedição):

| Origem (`PdvCorrectionOrigin`) | Quem devolve | Motivos (`PdvCorrectionReason`) |
|---|---|---|
| `FINANCE` | Financeiro | `PAYMENT_RECEIPT` (só esse) |
| `CD21_ANALYSIS` | CD21 — Análise | `CUSTOMER_NAME`, `CUSTOMER_DOCUMENT`, `PAYMENT_METHOD`, `INSTALLMENTS`, `SHIPPING_TYPE`, `ORDER_NUMBER`, `ORDER_DATE`, `TOTAL_VALUE`, `DISCOUNT_VALUE`, `BLING_PDF`, `PAYMENT_RECEIPT`, `OTHER_INFO` |
| `EXPEDITION` | CD21 — Expedição | `PRODUCT_UNAVAILABLE`, `ITEM_DIVERGENCE`, `DAMAGED_PRODUCT`, `OTHER_INFO` |
| `INVOICE_CANCELLED` | CD21 (automático, seção 7) | `INVOICE_CANCELLED` (só esse) |

Como a loja resolve cada origem:

| `correction_origin_status` | Endpoint que resolve | Detalhe |
|---|---|---|
| `PENDING_FINANCE` | `POST /:id/receipt` + `POST /:id/receipt/confirm` | **Não** usa `/correction/resolve` — troca o comprovante e confirma de novo, mesmo fluxo da seção 5.2 |
| `PENDING_CD21_ANALYSIS` | `POST /:id/correction/resolve` sem `decision` | Ajuste é feito direto na Bling (fora do sistema); este endpoint só confirma e reenvia pra `PENDING_CD21_ANALYSIS` |
| `SHIPPING` | `POST /:id/correction/resolve` com `decision: "CANCEL" \| "EXCHANGE_PRODUCT"` | `CANCEL` → `CANCELLED`. `EXCHANGE_PRODUCT` → `PENDING_CD21_ANALYSIS` (reanálise completa, pode impactar a nota já gerada) |
| `INVOICE_CANCELLED` | `POST /:id/correction/resolve` com `decision: "CANCEL" \| "RETRY_ANALYSIS"` | Ver seção 7 |

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

## 8. Obter o link/token de uma tela

Token não fica salvo em lugar nenhum — é derivado. Pra montar/copiar o
link de uma loja (ex.: tela de administração cadastrando uma loja nova),
chame (precisa de acesso a alguma tela, via login ou link):

| Método | Rota | Resposta |
|---|---|---|
| GET | `/api/pdv-access/store/:unitBusinessId` | `{ screen, unitBusinessNumber, url }[]` — as 3 telas da loja |
| GET | `/api/pdv-access/telesales` | `{ url }` — token único, não varia por loja |

`url` já é o link completo pronto pra abrir no browser/mandar pra pessoa —
não é mais sugestão, é o contrato fixo. Rota única no front, tela vem na
query string (confirmado testando contra o router real — não é path por
tela):

```
https://hub.paxpneus.com.br/pdv-management?token=<token>&screen=<tela>&number=<número>
```

(`FRONTEND_URL` no ambiente sobrescreve o domínio; `<tela>` é `store_request`
| `finance` | `cd21` | `telesales`). O front lê `number`/`token`/`screen` da
própria URL e manda os dois primeiros como os headers da seção 4.1 em toda
chamada pra `/api/sales-request/*`. Pro link de televendas não vem `number`
(a loja é escolhida em tempo de navegação, dentro do front) — as outras 3
sempre vêm com `number` embutido.

## 9. Tipos

```ts
enum PdvSalesRequestStatus {
  OPEN, PENDING_FINANCE, PENDING_CD21_ANALYSIS, PENDING_CORRECTION,
  PENDING_NF_SALE, PENDING_NF_TRANSFER, SHIPPING, FINISHED,
  CANCELLED, INVOICE_CANCELLED,
}

enum PdvShippingType { TRANSPORTADORA, ADT }

enum PdvCorrectionOrigin { FINANCE, CD21_ANALYSIS, EXPEDITION, INVOICE_CANCELLED }

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

## 10. Erros

| Status | Quando |
|---|---|
| `400` | Header de link faltando, ou parâmetro obrigatório faltando no body |
| `401` | Token inválido/não bate com a tela da rota, sem login e sem headers |
| `403` | Televendas tentando acessar a loja CD21; `orderId` de outra loja no `POST /` |
| `404` | Solicitação/loja não encontrada, ou não pertence à loja do acesso |
| `500` | Erro interno (inclui: variável de ambiente do segredo de token não configurada no servidor — reportar pro back, não é algo que o front resolve) |

Toda resposta de erro é `{ "error": "mensagem" }`.
