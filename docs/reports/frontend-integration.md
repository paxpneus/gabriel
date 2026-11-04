# Relatórios de comissão de vendedor e de problemas de integração: contrato com o front

Dois relatórios novos, só leitura, e uma mudança no relatório de devolução:

1. **Comissão de vendedor**: `GET /api/seller-commission-report`
2. **Problemas de integração**: `GET /api/integration-problems-report`
3. **Relatório de devolução**: `GET /api/sales-return-report`. Os avisos passam a vir só com a contagem.

Todas as rotas exigem autenticação e a permissão `financial-pdt`, a mesma dos relatórios de faturado e de devolução. Os dados são só da Loja 21 (CD21). Não há paginação: a resposta traz tudo do período.

---

## Regras comuns

**Período.** `start_date` e `end_date` são obrigatórios, no formato `YYYY-MM-DD`, e os dois dias entram inteiros (horário de Brasília). O período é aplicado à **data da saída no estoque**, não à data do pedido. Um pedido de setembro com nota que saiu em 1º de outubro aparece em outubro.

**Listas.** Os filtros que aceitam mais de um valor podem ser enviados uma vez (`seller_id=uuid`) ou repetidos (`seller_id[]=uuid1&seller_id[]=uuid2`).

**Erros.**

| Status | Quando | Corpo |
|---|---|---|
| `400` | Data ausente, em formato errado ou inválida; data inicial depois da final; id que não é UUID | `{ "error": "Data inicial é obrigatória; Vendedor inválido" }`: as mensagens vêm juntas, separadas por `; ` |
| `500` | Erro inesperado | `{ "error": "mensagem" }` |

As mensagens do `400` já estão em português e podem ser exibidas como estão.

**Valores.** Dinheiro e quantidade vêm como **número** (`756`, `3.78`), nunca como string. As taxas de comissão vêm em percentual: `0.5` significa 0,5%.

---

## 1. Comissão de vendedor: `GET /api/seller-commission-report`

Traz a comissão de vendedor e a de gerente por item vendido, com o total de cada uma. Entram as vendas cuja nota teve saída no estoque do CD21 no período e cujo pedido tem vendedor. Venda de marketplace ("Vendedor 0") não entra.

### Parâmetros

| Parâmetro | Obrigatório | Formato | O que filtra |
|---|---|---|---|
| `start_date` | sim | `YYYY-MM-DD` | Início do período |
| `end_date` | sim | `YYYY-MM-DD` | Fim do período |
| `brand` | não | texto, um ou vários | Marca do produto (mesmo texto do filtro de marca do relatório de devolução) |
| `product_id` | não | UUID, um ou vários | Produto |
| `seller_id` | não | UUID, um ou vários | Vendedor: o mesmo id de vendedor usado no relatório de vendedores |
| `manager_id` | não | UUID, um ou vários | Gerente: id do **contato** do tipo `SELLER_MANAGER` (ver "Quem é o gerente" abaixo). Filtra as vendas da loja desse gerente |

Com `brand` e `product_id` juntos, entram só os produtos que atendem aos dois.

### Quem é o gerente

O gerente é um contato (`/api/contacts`) com `type = "SELLER_MANAGER"` e com a loja dele em `unit_business_id`. Ele ganha a comissão de gerente de **todas as vendas com vendedor da loja dele**, inclusive as que ele mesmo vendeu: 30 vendas de vendedores na Loja 15 dão comissão de gerente das 30 para o gerente da Loja 15.

Para tornar um vendedor gerente, atualizar o contato pela rota de edição de contatos que já existe:

```http
PUT /api/contacts/:id
{ "type": "SELLER_MANAGER", "unit_business_id": "uuid-da-loja" }
```

Para voltar a ser só vendedor, mandar `"type": "SELLER"`. O gerente continua sendo vendedor: as vendas que ele fizer no Bling continuam com ele como vendedor. A lista de gerentes para o filtro sai da listagem de contatos com tipo `SELLER_MANAGER`.

Exemplo: `GET /api/seller-commission-report?start_date=2026-10-01&end_date=2026-10-31&seller_id=uuid`

### Resposta

```json
{
  "filters": {
    "start_date": "2026-10-01",
    "end_date": "2026-10-31",
    "unit_business_id": "uuid",
    "brand": null,
    "product_id": null,
    "seller_id": ["uuid"],
    "manager_id": null
  },
  "rows": [
    {
      "order_item_id": "uuid",
      "order_id": "uuid",
      "store_name": "Loja 10 - Lins",
      "order_date": "2026-09-23",
      "order_number": "20503",
      "invoice_number": "019458",
      "movement_date": "2026-10-01",
      "seller_name": "Carolina Nascimento A.",
      "manager_name": "Gerente A, Gerente B",
      "customer_name": "ELAINE CRISTINA FERREIRA DOS SANTOS",
      "brand": "General Tire",
      "product": "Pneu 195/55R15 85V FR Altimax One S General Tire",
      "sku": "15549030000",
      "quantity": 2,
      "total_value": 756,
      "commission_base": 756,
      "seller_commission_rate": 0.5,
      "seller_commission_value": 3.78,
      "manager_commission_rate": 0.5,
      "manager_commission_value": 3.78
    }
  ],
  "summary": {
    "orders_count": 456,
    "items_quantity": 1401,
    "total_value": 870185.43,
    "commission_base": 867680.06,
    "total_seller_commission": 4198.19,
    "total_manager_commission": 4198.19
  },
  "warnings": {
    "invoices_without_movement": 1,
    "cancelled_invoices_return_without_movement": 2,
    "cancelled_invoices_without_return": 1,
    "orders_not_in_seller_report": 0,
    "orders_missing_cost": 0,
    "orders_not_completed": 0
  }
}
```

### `rows[]`: uma linha por item do pedido

| Campo | Tipo | O que é |
|---|---|---|
| `order_item_id` | UUID | Id do item; usar como chave da linha |
| `order_id` | UUID | Id do pedido; vários itens do mesmo pedido repetem o valor |
| `store_name` | texto ou `null` | Loja da venda |
| `order_date` | `YYYY-MM-DD` | Data do pedido |
| `order_number` | texto ou `null` | Número do pedido |
| `invoice_number` | texto ou `null` | Número da nota de venda |
| `movement_date` | `YYYY-MM-DD` ou `null` | Data da saída no estoque (é a data que o período filtra) |
| `seller_name` | texto ou `null` | Vendedor |
| `manager_name` | texto ou `null` | Gerente(s) da loja da venda (contatos `SELLER_MANAGER` daquela loja). Com mais de um gerente, os nomes vêm juntos, separados por `, `. `null` quando a loja não tem gerente cadastrado; mesmo assim a comissão de gerente vem calculada |
| `customer_name` | texto ou `null` | Cliente |
| `brand` | texto ou `null` | Marca do produto |
| `product` | texto ou `null` | Nome do produto |
| `sku` | texto ou `null` | SKU do item no pedido |
| `quantity` | número | Quantidade vendida |
| `total_value` | número | Valor do item, antes do desconto do pedido |
| `commission_base` | número | Valor do item depois do desconto do pedido; é sobre ele que as duas comissões são calculadas |
| `seller_commission_rate` | número | Taxa da comissão do vendedor, em % |
| `seller_commission_value` | número | Comissão do vendedor, em R$ |
| `manager_commission_rate` | número | Taxa da comissão do gerente, em % |
| `manager_commission_value` | número | Comissão do gerente, em R$ |

As linhas vêm ordenadas por data do pedido e número do pedido.

### `summary`

É a soma exata das linhas retornadas, com os mesmos filtros. O front não precisa somar.

| Campo | O que é |
|---|---|
| `orders_count` | Quantidade de pedidos |
| `items_quantity` | Soma de `quantity` |
| `total_value` | Soma de `total_value` |
| `commission_base` | Soma de `commission_base` |
| `total_seller_commission` | **Total de comissão dos vendedores** |
| `total_manager_commission` | **Total de comissão dos gerentes** |

### `warnings`: só contagem

Quantas **vendas com vendedor** (as que deveriam entrar na comissão) ficaram fora do relatório, por motivo. Cada nota conta em um motivo só. Venda sem vendedor identificável não conta em nenhum aviso: marketplace ("Vendedor 0"), nota sem pedido no sistema e saída com nota inexistente. Essas aparecem só no relatório de problemas de integração (seção 2), que lista tudo. Aqui vêm só os números.

Com filtro de vendedor ou de gerente, a contagem considera só as vendas desse vendedor ou das lojas desse gerente.

Sugestão de texto para a tela:

| Campo | Texto sugerido |
|---|---|
| `invoices_without_movement` | Notas de venda sem saída no estoque |
| `cancelled_invoices_return_without_movement` | Notas canceladas com devolução no sistema, mas sem entrada da devolução no estoque |
| `cancelled_invoices_without_return` | Notas canceladas sem devolução e com a saída ainda ativa no estoque |
| `orders_not_in_seller_report` | Pedidos ainda não processados pelo relatório de vendedores |
| `orders_missing_cost` | Pedidos com produto sem custo médio |
| `orders_not_completed` | Pedidos não concluídos |

Nota cancelada que já tem a devolução lançada no estoque não é aviso: ela simplesmente não aparece.

---

## 2. Problemas de integração: `GET /api/integration-problems-report`

Lista as notas fiscais que não batem com o estoque do CD21 no período, nas vendas e nas devoluções. Serve para corrigir a integração, não traz valores.

### Parâmetros

| Parâmetro | Obrigatório | Formato |
|---|---|---|
| `start_date` | sim | `YYYY-MM-DD` |
| `end_date` | sim | `YYYY-MM-DD` |

Não há outros filtros.

### Resposta

```json
{
  "filters": {
    "start_date": "2026-10-01",
    "end_date": "2026-10-31",
    "unit_business_id": "uuid"
  },
  "rows": [
    {
      "problem": "cancelled_invoice_return_without_movement",
      "description": "Nota cancelada com devolução no sistema, mas sem entrada da devolução no estoque",
      "invoice_number": "019490",
      "date": "2026-10-02",
      "order_number": "21464",
      "return_invoice_number": "021999"
    },
    {
      "problem": "sale_invoice_without_order",
      "description": "Nota de venda sem pedido no sistema",
      "invoice_number": "019563",
      "date": "2026-10-02",
      "order_number": null,
      "return_invoice_number": null
    }
  ],
  "summary": {
    "sale_movement_without_invoice": 0,
    "sale_invoice_without_movement": 1,
    "cancelled_invoice_return_without_movement": 2,
    "cancelled_invoice_without_return": 1,
    "sale_invoice_without_order": 20,
    "return_movement_without_invoice": 0,
    "return_invoice_without_movement": 3,
    "total": 27
  }
}
```

### `rows[]`: uma linha por nota com problema

| Campo | Tipo | O que é |
|---|---|---|
| `problem` | código (tabela abaixo) | Tipo do problema; usar para agrupar, filtrar na tela ou escolher ícone |
| `description` | texto | Explicação do problema, já em português; pode ser exibida como está |
| `invoice_number` | texto ou `null` | Número da nota. Nos problemas de devolução, é a nota de devolução |
| `date` | `YYYY-MM-DD` ou `null` | Data da movimentação no estoque. Quando a nota não tem movimentação (`*_without_movement`), é a data de emissão |
| `order_number` | texto ou `null` | Número do pedido, quando a nota tem pedido |
| `return_invoice_number` | texto ou `null` | Número da nota de devolução; só vem preenchido em `cancelled_invoice_return_without_movement` |

As linhas já vêm ordenadas: pela ordem da tabela abaixo, depois por data e por número da nota. Não há id por linha: para chave, usar `problem` + `invoice_number` + `date`.

### Códigos de `problem`

| Código | Lado | `description` |
|---|---|---|
| `sale_movement_without_invoice` | Venda | Saída no estoque com nota que não existe no sistema |
| `sale_invoice_without_movement` | Venda | Nota de venda sem saída no estoque |
| `cancelled_invoice_return_without_movement` | Venda | Nota cancelada com devolução no sistema, mas sem entrada da devolução no estoque |
| `cancelled_invoice_without_return` | Venda | Nota cancelada sem devolução e com a saída ainda ativa no estoque |
| `sale_invoice_without_order` | Venda | Nota de venda sem pedido no sistema |
| `return_movement_without_invoice` | Devolução | Devolução no estoque com nota que não existe no sistema |
| `return_invoice_without_movement` | Devolução | Nota de devolução sem entrada no estoque |

A mesma situação pode aparecer em duas linhas, uma de cada lado. Exemplo: a nota 019490 cancelada com a devolução 021999 sem entrada no estoque aparece como `cancelled_invoice_return_without_movement` (nota 019490) e como `return_invoice_without_movement` (nota 021999). É esperado: as duas linhas vêm da mesma causa.

### `summary`

Quantidade de linhas por código, sempre com todos os códigos presentes (zero quando não há), e `total` com a soma. Ele lista todas as notas, inclusive marketplace e notas sem pedido, então os números de venda são maiores que os `warnings` do relatório de comissão, que contam só vendas com vendedor. Os de devolução batem com os `warnings` do relatório de devolução sem filtros.

---

## 3. Mudança no relatório de devolução: `GET /api/sales-return-report`

Só o bloco `warnings` mudou: os dois avisos eram um objeto com contagem e lista de notas e agora são só a contagem. A lista das notas foi para o relatório de problemas de integração (`return_movement_without_invoice` e `return_invoice_without_movement`). Parâmetros, `rows` e `summary` continuam iguais.

Antes:

```json
"warnings": {
  "movements_without_invoice": { "count": 0, "invoice_numbers": [] },
  "invoices_without_movement": { "count": 3, "invoice_numbers": ["019846", "020912", "021999"] }
}
```

Agora:

```json
"warnings": {
  "movements_without_invoice": 0,
  "invoices_without_movement": 3
}
```

O front que lia `warnings.*.count` passa a ler `warnings.*` direto, e quem mostrava `invoice_numbers` passa a apontar para o relatório de problemas de integração.
