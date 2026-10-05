# PDV Management — integração com o front

Regra pra atualizar este arquivo: a cada alteração no módulo PDV, documentar
só o que for NOVO ou o que MUDOU no fluxo — de forma curta, só o essencial
pro front saber integrar. Nada de contrato completo/histórico redundante
aqui.

**Migrations desta entrega** (rodar antes do deploy, em ordem): `m300` (tabela `order_payments`, remove `orders.payment_method_id`), `m301` (seed/consolidação do catálogo agrupado), `m303` (coluna `form_description`, usada no `detail` de "Outros").

## Mudou: coluna com `description`/`highlighted`, loja no card de Televendas, `user.type`

- Coluna do quadro ganhou `description` (subtítulo, `string | null`) e `highlighted` (fila de trabalho da tela; coluna `extra` sempre `false`).
- `order.unitBusiness { number }` no card agora também em Televendas.
- `GET /api/users/me/get` (e o login) devolve `type` no topo do usuário (= `config.type`, ex. `"finance"`). Tela Financeiro = `user.type === "finance"` — comparar com a chave `type` de `/user_config/user-types/get`, não com o `label` "Financeiro".

## Mudou: `pdv-store:sync` diz qual solicitação/pedido mudou

Payload ganhou campos (os antigos continuam): `requests: [{ requestId, status }]` em `SALES_REQUEST_STATUS_CHANGED` (status atual, pós-mudança; no lote finalizado vem a lista da loja), `orderId` em `ORDER_STATUS_CHANGED`/`NEW_ORDER`. Serve pra recarregar só a coluna afetada (`GET /sales-request?column=`) em vez do quadro inteiro. `NEW_ORDER` só sai quando o pedido novo já tem a solicitação criada (card já existe no `GET`); pedido não elegível ao PDV não emite.

## Mudou (breaking): quadro do Kanban, `next_action` e detalhe enxuto

Back e front sobem juntos — sem modo legado. Contrato completo: bloco "Contrato da API — PDV" entregue com esta mudança. Migration `m310` (só índices, `CONCURRENTLY`).

- `GET /sales-request` passa a devolver `{ columns: [{ key, label, statuses, extra, items, totalCount, nextCursor, hasMore }] }`; com `column=<key>` (+ `cursor`), só o objeto daquela coluna. Params: `column`, `cursor`, `limit` (1–100, padrão 15), `include_closed`, `include_other_screens`. `filters[status]`, `page`, `perPage`, `sortBy` são ignorados; `search` e os outros `filters[...]` (inclusive `indicator`) seguem valendo. Coluna fora da tela → 403; parâmetro inválido → 400.
- Card: `id, status, shipping_label, next_action, order{id, number_order_system, number_order_channel, date, customer{name}, unitBusiness{number}* }, saleInvoice{tracking_url}` (*só financeiro/CD21). Saíram `order.status`, `customer.document`, `net_total_order`, `receipts`, `errors`, `createdAt`, `invoice_tracking_url` e o resto.
- `next_action` (string ou null, já da tela de quem pede) no card e no `GET /:id`. Ações não devolvem — refazer `GET /:id`.
- `GET /:id`: novo `shipping_info_required`; saíram `unit_business_id`, `order_id`, `order.id`, `errors.origin` (usar `correction_origin_status`), `invoice_tracking_url` (usar `saleInvoice.tracking_url`), `receipts[].path/validated/createdAt`, e `estabelecimento_*`/`cartao_final` das análises (também no socket `payment-receipt-analysis:done`). Card de outra loja → 404.
- Histórico: `id, step, description, date, user_id`.
- Link: `?screen=` (e `?number=` em loja/CD21) é conferido contra o token → 400/403. Login de loja 12/17 ou tela sem acesso à rota → 403.

## Novo: diferença comprovantes x pedido (`receipt_total_difference`)

Campo novo na solicitação (migration `m308`; `m309` preenche as solicitações já existentes), vem na listagem e no `GET /sales-request/:id`: `receipt_total_difference: number | null` = `payment_receipt_analysis.valor_total` (soma dos comprovantes) − total do pedido (`order.net_total_order`).
- negativo → pagou a menos (ex.: `-20.3`)
- positivo → pagou a mais
- `0` → bate (mesmo caso de `receipt_total_matches_order: true`)
- `null` → sem comprovante com valor ou pedido sem total

Recalculado junto com `receipt_total_matches_order` (anexar/editar/remover comprovante e `PATCH /:id/payment-receipt-analysis`). O evento `payment-receipt-analysis:done` também traz `reconciled.totalDifference`.

## Novo: origem da solicitação (`origin`)

Campo novo `origin` (migration `m307`): `"TELEVENDAS"` | `"LOJA"` | `null`. Vem na listagem e no `GET /sales-request/:id`. Só leitura — o backend grava sozinho, uma vez só, na primeira ação entre definir o tipo de envio (`POST /:id/shipping-type`) e anexar comprovante (`POST /:id/receipt`):
- link de Televendas → `TELEVENDAS`
- link da loja ou usuário logado numa loja → `LOJA`

Financeiro/CD21 nunca definem origem. Fica `null` até a primeira dessas ações (e em solicitações antigas).

Filtro: `GET /sales-request?filters[origin]=TELEVENDAS` (ou `LOJA`).

## Novo: endereço de envio e transportadora na solicitação

Dois campos novos de texto livre na solicitação (migration `m306`), já vêm na listagem e no `GET /sales-request/:id`:
- `shipping_address` — endereço de envio
- `transporter_name` — transportadora

Pra gravar: `PATCH /sales-request/:id/shipping-info` body `{ shippingAddress?, transporterName? }`. Parcial: só o campo enviado muda; `""`/`null` limpa. Mesma janela de edição do `shipping-type` (loja em `OPEN`/`PENDING_CORRECTION` de qualquer origem, financeiro em `PENDING_FINANCE`, CD21 em `PENDING_CD21_ANALYSIS`/`PENDING_NF_SALE`). Responde a solicitação atualizada. Body sem nenhum dos dois → `400`.

**Regra de obrigatoriedade:** só pode ir de **Em aberto** (`OPEN`) para **Análise financeiro** (`PENDING_FINANCE`) se esses campos estiverem preenchidos, ou ir de uma **correção** (`PENDING_CORRECTION`) para o status que tava antes (`correction_origin_status`) se esses campos estiverem preenchidos. Essa regra de obrigar o campo preenchido é só se:
- o pedido (order) ainda não tem nota de venda (sale invoice id), **ou**
- a nota de venda não tem transportadora, **ou**
- a nota de venda tem transportadora, mas é a transportadora `"Sem transporte"`.

Só nesses status que cobra — `PENDING_CORRECTION` e `OPEN` — e só nessa condição acima. Com nota de venda com transportadora de verdade, os campos são opcionais.

Na prática, as chamadas que passam a validar:
- `POST /sales-request/:id/receipt/confirm` (`OPEN` → `PENDING_FINANCE` e `PENDING_CORRECTION` de origem financeiro → `PENDING_FINANCE`)
- `POST /sales-request/:id/correction/resolve` quando volta pro status de origem (origem `PENDING_CD21_ANALYSIS`). As decisões que vão pra outro status (`CANCEL`, `EXCHANGE_PRODUCT`, `RETRY_ANALYSIS`) não cobram.

Faltando (os dois precisam estar preenchidos) → `400 { error: "Preencha o endereço de envio e a transportadora antes de enviar a solicitação" }` (mensagem pronta pra exibir).

## Mudou: comprovante liga a uma forma de pagamento do catálogo

- `PATCH /sales-request/:id/receipt/:receiptId/analysis` aceita `payment_method_id` (uuid de `GET /api/payment_method`; `null` limpa). O backend deriva `tipo_comprovante` da descrição da forma (`null` se a forma não tem tipo no enum: Dinheiro, Cheque, Boleto, Outros) — dá pra parar de mandar `tipo_comprovante` nesse PATCH.
- `PATCH /sales-request/:id/payment-receipt-analysis` aceita `payment_method_ids` (uuid[]); `tipo_comprovante` vira os tipos derivados juntos com `" + "`.
- Respostas/leituras trazem `analysis.payment_method: { id, description } | null` por comprovante e `payment_receipt_analysis.payment_methods: [{ id, description }]` no resumo (`tipo_comprovante` continua como antes). A análise automática (OCR/PDF) já vem com `payment_method` preenchido quando acha exatamente uma forma correspondente (preferindo as do pedido); senão `null`.
- `payment_method_id` inexistente → 400 `Forma de pagamento não encontrada`.
- Nos dois PATCH, campo enviado como `""` (campo limpo no formulário) é tratado como `null`, não dá mais 400 de tipo.
- `payment_method_matches_receipt` passa a comparar por id quando o comprovante tem forma escolhida.

## Novo: `GET /api/payment_method` (formas de pagamento)

Lista paginada simples (`page`, `perPage`, `sortBy`, `sortDir`; padrão `description ASC`). `search` filtra só por `description`. Resposta: `{ data: [{ id, id_system, description, payment_type }], meta }`. Mesma auth das rotas do PDV (login ou link `x-pdv-*`). O catálogo é AGRUPADO por tipo (poucas linhas: Dinheiro, Cheque, Cartão de Crédito, Cartão de Débito, Boleto Bancário, Pix, Transferência Bancária, Outros), não uma linha por forma cadastrada na Bling.

## Mudou: `order.paymentMethod` virou `order.payments[]` (`GET /sales-request/:id`)

Pedido pode ter 1+ formas de pagamento (parcelas da Bling). O campo único `order.paymentMethod` **foi removido** do detalhe; no lugar:

```json
"payments": [
  { "paymentMethod": { "id": "uuid", "description": "Cartão de Crédito" },
    "detail": null, "amount": 1820.22, "installments": 12,
    "first_due_date": "2026-11-03", "last_due_date": "2027-09-27" }
]
```

Parcelas da mesma forma vêm AGRUPADAS num item só (12x crédito = 1 item: `amount` é a soma, `installments` a quantidade), ordenado pelo primeiro vencimento. `detail` só vem preenchido no grupo "Outros": o nome original da forma na Bling (ex.: `"Mercado Pago"`; se houver mais de uma, separadas por vírgula) — nos demais grupos é `null`. Pedidos antigos só ganham `detail` depois de ressincronizados. Só a resposta é agrupada — a comparação com comprovantes não muda. `order.installments` (total de parcelas do pedido) segue igual. O mesmo formato vale pro `payments` do detalhe de pedido em `/order` (sales-report detail). `payment_method_matches_receipt` agora compara o conjunto de formas do pedido com o de comprovantes: `true` só se toda forma tem comprovante do mesmo tipo e todo comprovante corresponde a uma forma; `false` se algum lado sobra; `null` sem formas/comprovantes ou com comprovante sem análise. Deixa de ser `null` quando há 2+ comprovantes. Pedido antigo, ainda não ressincronizado pela Bling, vem com `payments: []` e `payment_method_matches_receipt: null` (sem erro). A listagem (`GET /sales-request`) não traz pagamentos, como antes.

## Mudou: coluna de expedição dividida em `SHIPPING` (ADT) e `SHIP_TODAY` (TRANSPORTADORA)

Novo valor de `status`: **`SHIP_TODAY`** ("Embarque hoje"). Ele faz **exatamente
o mesmo** que `SHIPPING` fazia (aguardando lote/romaneio, `expedition_progress`,
`expedition/reject`, `finish`, auto-finish ao gerar romaneio, `PENDING_CORRECTION`
com `correction_origin_status`); só muda a coluna, pra dividir melhor.

| `shipping_type` | Destino ao sair de `PENDING_NF_SALE` (ou aprovação CD21 com nota já emitida) | Coluna |
|---|---|---|
| `ADT` | `PENDING_NF_TRANSFER` → (`transfer-invoice/confirm`) → **`SHIPPING`** | "Pendente expedição" (igual a antes) |
| `TRANSPORTADORA` | direto **`SHIP_TODAY`** (antes ia pra `SHIPPING`) | "Embarque hoje" |

- `SHIPPING` agora só recebe ADT; transferência de ADT continua indo pra
  `SHIPPING`. Transição `TRANSPORTADORA` → `SHIP_TODAY` não passa mais por `SHIPPING`.
- Tudo que o front checava com `status === "SHIPPING"` (botões de lote/romaneio,
  `expedition_progress`, rejeitar expedição, finalizar) precisa aceitar também
  `SHIP_TODAY`. `expedition_progress` vem preenchido nos dois.
- `correction_origin_status` pode ser `SHIP_TODAY` (rejeição de expedição vinda de
  `SHIP_TODAY`); `resolveCorrection` com essa origem exige `decision` igual ao
  de `SHIPPING` (`CANCEL`|`EXCHANGE_PRODUCT`). Em `sub_stats` do
  `pending_correction` (Loja/Televendas) entra a chave `SHIP_TODAY`.
- `transfer-invoice*` continua só pra ADT (`PENDING_NF_TRANSFER`/`SHIPPING`/`FINISHED`);
  `SHIP_TODAY` nunca tem nota de transferência.
- Solicitações `TRANSPORTADORA` que já estavam em `SHIPPING` são movidas pra `SHIP_TODAY` pela migration `m299` (status e `correction_origin_status`).
- Migrations `m298`/`m299`: `m298` adiciona `SHIP_TODAY` aos enums (status, origem da correção,
  `step` do histórico), `m299` move os dados antigos — rodar antes do deploy.

## Mudou: indicativos de expedição no `summary/status-counts` e filtro `indicator`

Tela **CD21** agora devolve (nesta ordem, junto dos demais): `adt_12`, `adt_17`,
`pending_expedition`, `ship_today`:

| key | label | critério |
|---|---|---|
| `adt_12` | `ADT CD 12` | `SHIPPING` + `shipping_type = ADT` + transportadora da nota de venda com `CD 12` |
| `adt_17` | `ADT CD 17` | `SHIPPING` + `shipping_type = ADT` + transportadora da nota de venda com `CD 17` |
| `pending_expedition` | `Pendente expedição` | `SHIPPING` + `shipping_type = ADT`, **qualquer transportadora** (não olha CD) |
| `ship_today` | `Embarque hoje` | `SHIP_TODAY` |

Atenção: `pending_expedition` é o total de ADT em `SHIPPING`, então **inclui** os
de `adt_12` e `adt_17` (não some os três). Entrar em `SHIPPING` depende só do
`shipping_type` (ADT); a transportadora só entra nos filtros/contadores de CD.
Resposta no formato de sempre, ex.: `"adt_12": { "label": "ADT CD 12", "quantity": 4 }`.

`cd21_billing` (Loja/Televendas) passou a somar também `SHIP_TODAY`.

Filtros na listagem: `GET /sales-request?filters[indicator]=adt_12`, `adt_17`,
`ship_today` e `pending_expedition` — mesmo critério
do número do indicativo. `filters[status]=SHIP_TODAY` também funciona.
`shipping_label` não mudou.

## Novo: busca por número do pedido na listagem

`GET /sales-request?filters[number_order_system]=<valor>` — busca parcial
(case-insensitive) pelo `number_order_system` do pedido vinculado.

## Novo: `shipping-type` cria a solicitação se não existir

`POST /sales-request/:id/shipping-type` — se `:id` não existir mais, mande
`orderId` no body junto de `shippingType`: cria a solicitação vazia na hora e
já aplica o tipo de envio nela. Sem `orderId` nesse caso, `404`.

## Novo: evento de websocket `salerequest-updated`

Mesma room de comprovante (`pdv-sales-request:<id>`, seção de análise
assíncrona). Disparado toda vez que a análise/resumo conciliado da
solicitação muda (editar análise de um comprovante, adicionar/remover
comprovante, editar o resumo direto). Payload só `{ requestId }` — é só um
sinal pra refazer o `GET /:id`, sem dado de negócio nele.

## Novo: filtros `reason` e `correction_origin_status` na listagem

`GET /sales-request?filters[reason]=<valor>` — solicitações cujo
`errors.reasons` contém o valor (`PdvCorrectionReason`, ex.:
`PAYMENT_RECEIPT`). Aceita múltiplos valores (`filters[reason][]=...`), match
é OR entre eles.

`GET /sales-request?filters[correction_origin_status]=<valor>` — igual/IN
direto na coluna (`PdvSalesRequestStatus`, ex.: `PENDING_FINANCE`). Também
aceita múltiplos valores.

## Novo: filtros `customer_name` e `date` (pedido vinculado) na listagem

`GET /sales-request?filters[customer_name]=<valor>` — busca parcial
(case-insensitive) pelo nome do cliente do pedido vinculado.

`GET /sales-request?filters[date][start]=YYYY-MM-DD&filters[date][end]=YYYY-MM-DD`
— filtra pelo período de `date` do pedido vinculado (qualquer um dos dois é
opcional).

## Novo: `GET /sales-request/summary/status-counts` (indicativos)

Igual em espírito ao `GET /orders/summary/status-counts` já existente — um
contador por indicativo, escopado pela tela do acesso (mesma auth de
`GET /sales-request`). Resposta: objeto por indicativo, `{ label, quantity,
sub_stats? }` — `sub_stats` só aparece no indicativo `pending_correction`
(tela loja/Televendas), chaveado por `correction_origin_status`. **Contrato
de `sub_stats` ainda pode mudar** (rótulo/formatação final a definir com o
front).

Indicativos por tela:
- **Loja/Televendas** (`STORE_REQUEST`): `open`, `pending_finance`,
  `pending_correction` (com `sub_stats`), `pending_cd21_analysis`,
  `cd21_billing` (soma NF de venda + NF de transferência + expedição `SHIPPING`/`SHIP_TODAY`).
- **Financeiro** (`FINANCE`): `pending_finance`,
  `pending_correction_finance_origin` (só correção originada do financeiro).
- **CD21**: `pending_nf_transfer`, `pending_nf_sale`,
  `pending_cd21_analysis`, `adt_12`, `adt_17`, `pending_expedition`, `ship_today`.

Exemplo (Loja/Televendas):

```json
{
  "open": { "label": "Em aberto", "quantity": 3 },
  "pending_finance": { "label": "Análise financeiro", "quantity": 5 },
  "pending_correction": {
    "label": "Pendente correção",
    "quantity": 10,
    "sub_stats": {
      "PENDING_FINANCE": 4,
      "PENDING_CD21_ANALYSIS": 3,
      "SHIPPING": 2,
      "INVOICE_CANCELLED": 1,
      "FINISHED": 0
    }
  },
  "pending_cd21_analysis": { "label": "CD21 análise", "quantity": 2 },
  "cd21_billing": { "label": "CD21 faturamento", "quantity": 7 }
}
```

## Novo: filtro `indicator` na listagem

`GET /sales-request?filters[indicator]=<key>` — filtra pelo MESMO critério
que popula o indicativo correspondente do `summary/status-counts` acima (ex.:
`filters[indicator]=cd21_billing` traz as solicitações em `PENDING_NF_SALE`
OU `PENDING_NF_TRANSFER` OU `SHIPPING` OU `SHIP_TODAY`). `<key>` é uma das chaves da resposta
de `summary/status-counts` (`open`, `pending_finance`, `pending_correction`,
`pending_correction_finance_origin`, `pending_cd21_analysis`,
`pending_nf_sale`, `pending_nf_transfer`, `pending_expedition`, `adt_12`,
`adt_17`, `ship_today`, `cd21_billing`) — clicar num indicativo do resumo e aplicar esse filtro deve
sempre bater com o número mostrado nele.

## Mudou: `DELETE /sales-request/:id` não apaga mais o registro

Continua permitido só em `OPEN`/`PENDING_CORRECTION` (`405` fora disso), mas
agora zera a solicitação em vez de apagar a linha: some o histórico, os
comprovantes anexados, `transfer_invoice_id` e todo campo de análise/erro,
mantém só `sale_invoice_id`, e o `status` vai pra um novo valor,
`EXCLUDED` (é terminal — o pedido volta a poder receber uma nova
solicitação). Resposta continua `204`. Se o front cacheava/exibia essa
solicitação em algum lugar por id, ela ainda existe, só que zerada e
`EXCLUDED` — não vai mais dar `404` depois de excluída.

## Mudou: pedido de loja `ONLINE` não ganha mais sale request automática

`createEmptyRequestForNewOrderIfEligible` (roda na criação do pedido vindo da
Bling) agora também exclui unit business com `type: ONLINE`, além de CD21 e
`PDV_EXCLUDED_STORE_NUMBERS` — antes só CD21/`PDV_EXCLUDED_STORE_NUMBERS`
eram excluídos, então pedido de loja online podia ganhar uma `PdvSalesRequest`
por engano. Regra final: toda order de loja física ganha sale request
automática, exceto CD21 e `PDV_EXCLUDED_STORE_NUMBERS`.

## Mudou: `/orders/eligible`

Não filtra mais por "status finalizador" — agora entra qualquer pedido
independente do `internal_status`, só não `CANCELLED`. Passou a excluir
também pedido cujo invoice já tem romaneio gerado na própria loja do pedido
(evita reabrir solicitação de pedido já expedido).

## Novo: busca livre (`search`) na listagem

`GET /sales-request?search=<valor>` — busca parcial (case-insensitive), OR
entre: `number_order_system` do pedido vinculado, nome do cliente do pedido,
documento (CPF/CNPJ) do cliente, `number_system` da nota de venda e
`number_system` da nota de transferência (as duas da própria solicitação).
Antes, mandar `search` nessa listagem zerava o resultado (a entidade não tem
campo próprio buscável pelo `search` genérico) — agora tem tratamento
dedicado. Combina normalmente com
`filters[...]` (ex.: `status`, `customer_name`) na mesma chamada.

## Novo: lote / romaneio / status do lote a partir da solicitação (CD21)

Rotas em `/api/batch` (mesmo prefixo de `generate-from-invoices`),
sempre pra unit business CD21, `OUTGOING`. A nota usada é sempre a de venda
(`order.invoice_id`) — o back re-sincroniza `sale_invoice_id` antes. Pedido
sem nota → `400 { error: "Pedido ainda não possui nota de venda" }`.
Auth: tela `CD21` (login ou headers `x-pdv-unit-business-number` +
`x-pdv-token`), igual às rotas de `/sales-request`. Erro sempre
`400 { error }`.

| Ação | Rota | Resposta |
|---|---|---|
| Status do lote | `GET /in-batch/pdv-sales-request/:salesRequestId` | `200 { in_batch, batch_finished, delivery_note_generated }` (booleans; tudo `false` se a nota não está em lote) |
| Gerar lote | `POST /generate-from-pdv-sales-request/:salesRequestId` (sem body) | `201` lote completo (`ExpeditionBatch` + `batchInvoices` + items) |
| Adicionar a lote pendente | `POST /add-pdv-sales-request-to-pending/:salesRequestId` (sem body) | `200` lote completo; cria lote novo se não houver pendente |
| Gerar romaneio | `GET /delivery-note/pdv-sales-request/:salesRequestId?userId=<uuid>` | `200` lote completo com `delivery_note_generated_at`/`operator_id` |
| Último lote pendente de saída | `GET /api/unit-business/last-outgoing-batch-number/get-or-update` | `200 string \| null` (número do lote `OUTGOING` do CD21 não `FINISHED`, mais recente) |
| Buscar lotes pendentes de saída | `GET /api/batch/outgoing-pending/search?search=&page=` | `200` `PaginatedData<ExpeditionBatch>` filtrado pelo CD21 |
| Adicionar a um lote específico | `POST /api/batch/add-pdv-sales-request-to-batch/:salesRequestId` body `{ batch_id: string }` | `200` lote completo; `400 { error }` se `batch_id` ausente, lote inexistente/finalizado ou que não seja `OUTGOING` do CD21 |

As 3 últimas linhas aceitam o link CD21 (`x-pdv-unit-business-number` +
`x-pdv-token`, tela CD21) sem id de loja: o back resolve CD21 + `OUTGOING`.
As duas primeiras são as rotas de sempre (com login nada muda; link só vale
com token da tela CD21, qualquer outro token → `401`). A terceira é nova e
usa a nota de venda do pedido — o front não precisa do `xml_key`.

`userId` só vale via link (via login o back usa o usuário logado). Gerar
romaneio dispara o auto-finish da solicitação (`SHIPPING` → `FINISHED`),
com o mesmo sync de loja de qualquer transição de status. Gerar lote falha com `"Nota(s) com produtos não
mapeados: <números>"` se a nota tem produto pendente de mapeamento.

## Novo: `shipping_label` na listagem e no `GET /sales-request/:id`

Campo calculado na resposta (não persistido). `shipping_type = TRANSPORTADORA`
→ `"Embarque hoje"`. `shipping_type = ADT` → `"ADT CD 12"` / `"ADT CD 17"`
conforme a transportadora da nota de venda (`LOGISTICA PAX PNEUS SP - CD 12` /
`... PR - CD 17`). ADT com
outra transportadora (ou nota ainda inexistente) → só `"ADT"`. `null` apenas
se `shipping_type` não foi definido.
`saleInvoice` também passou a trazer `transporter_name`.

## Novo: `expedition_progress` no `GET /sales-request/:id`

Só quando `status === "SHIPPING"`; nos outros status vem `null`. Não existe
na listagem. Substitui a chamada extra a `GET /batch/in-batch/pdv-sales-request/:id`
(que continua existindo). Os 3 booleanos seguem no objeto pros botões da etapa.

```json
"expedition_progress": {
  "in_batch": true,
  "batch_finished": true,
  "delivery_note_generated": false,
  "progress": "BATCH_FINISHED",
  "progress_message": "Lote finalizado, mas precisa gerar romaneio"
}
```

| in_batch | batch_finished | delivery_note_generated | progress | progress_message |
|---|---|---|---|---|
| false | false | false | `NOT_IN_BATCH` | Lote ainda não gerado! |
| true | false | false | `IN_BATCH` | Lote gerado, conferência de produtos em andamento |
| true | true | false | `BATCH_FINISHED` | Lote finalizado, mas precisa gerar romaneio |
| true | true | true | `DELIVERY_NOTE_GENERATED` | Romaneio gerado mas não atualizado no hub, finalize manualmente! |

## Novo: `order.status` na listagem e no `GET /sales-request/:id`

`order.status` = situação atual do pedido (`actual_situation` da Bling)
traduzida pro nome mapeado no sistema (`display_name`, ex.: `"Em Aberto"`,
`"Atendido"`, `"Aguardando Verificação Humana"`); se não houver mapeamento,
vem o código bruto, e `null` se o pedido não tem situação. Só nesses dois
endpoints — `/orders/eligible` e `/orders/:orderId` não mudaram.

## Novo: `invoice_tracking_url` na listagem e no `GET /sales-request/:id`

Link de rastreio da entrega da nota de venda
(`https://paxpneus.acompanharentrega.com.br/?tpDoc=4&doc=002%2F<número sem zeros à esquerda>`).
Também vem em `saleInvoice.tracking_url`. `null` sem nota de venda ou se a
nota ainda não foi importada pela Bling.

## Novo: ADT só com transportadora CD 12 / CD 17

O tipo de envio tem que bater com a transportadora da nota de venda:
- `... - CD 12` / `... - CD 17` → só `ADT`. `TRANSPORTADORA` → `400 { error:
  "A transportadora deste pedido é o CD 12, então o tipo de envio só pode ser ADT." }`
- qualquer outra → só `TRANSPORTADORA`. `ADT` → `400 { error: "ADT só é permitido
  para pedidos com transportadora CD 12 ou CD 17. A transportadora deste pedido
  é <nome>, então o tipo de envio só pode ser TRANSPORTADORA." }`

Mensagens prontas pra exibir. Vale pra `POST /:id/shipping-type` e pra rota
nova abaixo. Sem checagem (aceita os dois) se ainda não há nota de venda ou se
a nota não tem transportadora ("Sem transporte").

## Novo: `POST /sales-request/:id/shipping-type/change` (CD21)

Troca o tipo de envio de uma solicitação já em faturamento/expedição. Body
`{ shippingType: "ADT" | "TRANSPORTADORA" }`, só tela CD21. Responde a
solicitação atualizada; o status pode mudar (sync de loja dispara como em
qualquer transição).

| Status atual | Troca | Novo status |
|---|---|---|
| `PENDING_NF_SALE` | qualquer | continua `PENDING_NF_SALE` (quando a nota sair, segue o tipo novo) |
| `PENDING_NF_TRANSFER` | ADT → TRANSPORTADORA | `SHIP_TODAY` (ou `FINISHED` se a nota de venda já tem romaneio) |
| `SHIPPING` | ADT → TRANSPORTADORA | `SHIP_TODAY` (ou `FINISHED` se a nota de venda já tem romaneio) |
| `SHIP_TODAY` | TRANSPORTADORA → ADT | `SHIPPING` |

ADT → TRANSPORTADORA zera `transfer_invoice_id` (`transferInvoice` vem `null`).
TRANSPORTADORA → ADT vai pra `SHIPPING` sem nota de transferência — o CD21
vincula depois por `POST /:id/transfer-invoice` (aceito em `SHIPPING`).
Mandar o mesmo tipo atual não faz nada (`200`). Qualquer outro status → `400`
`"Ação inválida: ..."`.

## Mudou: toda ação na solicitação dispara websocket

Toda mudança numa solicitação (transição de status, tipo de envio, anexar/
remover/editar comprovante, nota de transferência, re-sync da nota de venda,
gerar lote/romaneio/adicionar a lote pela solicitação, exclusão) agora emite
os DOIS eventos, sempre juntos:
- `pdv-store:sync` com `event: "SALES_REQUEST_STATUS_CHANGED"` (rooms da loja +
  CD21) → refazer a listagem/Kanban. Antes só vinha em mudança de status; agora
  vem também em mudança sem troca de status.
- `salerequest-updated` `{ requestId }` (room `pdv-sales-request:<id>`) →
  refazer o `GET /:id` se o detalhe estiver aberto.

Finalizar lote (`PUT /batch/finish/:batchId`, de qualquer tela) também avisa
as solicitações ativas cujas notas de venda estão no lote (`expedition_progress`
vira `BATCH_FINISHED`), sem inundar o Kanban: `pdv-store:sync` sai UMA vez por
loja afetada e UMA vez só pra room do CD21 (nessa, `unitBusinessId: null`) —
um refetch atualiza todas. `salerequest-updated` sai um por solicitação, cada
um só na room dela. Payload continua sendo só sinal de refetch.

`salerequest-updated` só chega pra quem deu `pdv-sales-request:watch`
`{ requestId }` naquela solicitação (card aberto) — sem watch, nada chega.
Não existe unwatch: o socket fica na room até desconectar, então quem abriu o
card A, fechou e abriu o B continua recebendo os eventos do A. Antes de
refazer o `GET /:id`, conferir se `payload.requestId` é o card aberto.
