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

## Mudou: `/orders/eligible`

Não filtra mais por "status finalizador" — agora entra qualquer pedido
independente do `internal_status`, só não `CANCELLED`. Passou a excluir
também pedido cujo invoice já tem romaneio gerado na própria loja do pedido
(evita reabrir solicitação de pedido já expedido).
