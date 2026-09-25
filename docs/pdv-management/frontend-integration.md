# PDV Management — integração com o front

Regra pra atualizar este arquivo: a cada alteração no módulo PDV, documentar
só o que for NOVO ou o que MUDOU no fluxo — de forma curta, só o essencial
pro front saber integrar. Nada de contrato completo/histórico redundante
aqui.

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
  `cd21_billing` (soma NF de venda + NF de transferência + expedição).
- **Financeiro** (`FINANCE`): `pending_finance`,
  `pending_correction_finance_origin` (só correção originada do financeiro).
- **CD21**: `pending_nf_transfer`, `pending_nf_sale`,
  `pending_cd21_analysis`, `pending_expedition`.

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
OU `PENDING_NF_TRANSFER` OU `SHIPPING`). `<key>` é uma das chaves da resposta
de `summary/status-counts` (`open`, `pending_finance`, `pending_correction`,
`pending_correction_finance_origin`, `pending_cd21_analysis`,
`pending_nf_sale`, `pending_nf_transfer`, `pending_expedition`,
`cd21_billing`) — clicar num indicativo do resumo e aplicar esse filtro deve
sempre bater com o número mostrado nele.

## Mudou: `/orders/eligible`

Não filtra mais por "status finalizador" — agora entra qualquer pedido
independente do `internal_status`, só não `CANCELLED`. Passou a excluir
também pedido cujo invoice já tem romaneio gerado na própria loja do pedido
(evita reabrir solicitação de pedido já expedido).
