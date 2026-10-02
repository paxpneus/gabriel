# PDV Management — integração com o front

Regra pra atualizar este arquivo: a cada alteração no módulo PDV, documentar
só o que for NOVO ou o que MUDOU no fluxo — de forma curta, só o essencial
pro front saber integrar. Nada de contrato completo/histórico redundante
aqui.

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
