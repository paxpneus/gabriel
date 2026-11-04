# Relatórios de comissão de vendedor e de problemas de integração: contrato com o front

Dois relatórios novos, só leitura, e uma mudança no relatório de devolução:

1. **Comissão de vendedor**: `GET /api/seller-commission-report`
2. **Problemas de integração**: `GET /api/integration-problems-report`
3. **Relatório de devolução**: `GET /api/sales-return-report`. Os avisos passam a vir só com a contagem.
4. **Relatório de vendedores**: `GET /api/seller-report`. Comissão de gerente só de loja com gerente e comissão dos gerentes regionais.

Todas as rotas exigem autenticação e a permissão `financial-pdt`, a mesma dos relatórios de faturado e de devolução. A comissão é de todas as lojas; os relatórios de problemas de integração e de devolução são só da Loja 21 (CD21). Não há paginação: a resposta traz tudo do período.

---

## Regras comuns

**Período.** `start_date` e `end_date` são obrigatórios, no formato `YYYY-MM-DD`, e os dois dias entram inteiros (horário de Brasília). Na comissão, o período é aplicado à **data do pedido**, igual ao relatório de vendedores: um pedido de 29/09 com nota emitida em 05/10 aparece em setembro. Nos relatórios de problemas de integração e de devolução, o período é aplicado à **data da saída no estoque**.

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

Traz a comissão de vendedor e a de gerente por item vendido, com o total de cada uma. A base é a mesma do relatório de vendedores (`/api/seller-report`): pedidos com vendedor pela data do pedido, só vendas válidas (com custo e não canceladas). Venda de marketplace ("Vendedor 0") não entra.

Só entram os pedidos **faturados no Bling**: situação Atendido, Enviado ou Entregue **e** com nota fiscal de venda vinculada e não cancelada. Os outros pedidos do período aparecem só na contagem de `warnings`.

**Comissão só de pedido faturado, em todos os relatórios.** A mesma regra vale para o relatório de vendedores e para o relatório de vendas: pedido em aberto, ou em situação final ainda sem nota de venda, continua contando como venda (valor, quantidade, ticket), mas com comissão de vendedor e de gerente **0**. Quando o pedido é faturado, a comissão aparece no próximo processamento dos relatórios.

### Parâmetros

| Parâmetro | Obrigatório | Formato | O que filtra |
|---|---|---|---|
| `start_date` | sim | `YYYY-MM-DD` | Início do período |
| `end_date` | sim | `YYYY-MM-DD` | Fim do período |
| `brand` | não | texto, um ou vários | Marca do produto (mesmo texto do filtro de marca do relatório de devolução) |
| `product_id` | não | UUID, um ou vários | Produto |
| `seller_id` | não | UUID, um ou vários | Vendedor: o mesmo id de vendedor usado no relatório de vendedores |
| `manager_id` | não | UUID, um ou vários | Gerente: id do **contato** do tipo `SELLER_MANAGER` (ver "Quem é o gerente" abaixo). Filtra as vendas da loja desse gerente e, se ele for gerente regional, também das lojas do grupo dele |
| `unit_business_id` | não | UUID, um ou vários | Loja do pedido (a mesma de `store_name`) |
| `origin_unit_business_id` | não | UUID, um ou vários | Loja de origem gravada na nota de venda. Quase sempre é a loja do pedido; pedido sem nota não tem loja de origem e some com esse filtro (também dos `warnings`) |

Com `brand` e `product_id` juntos, entram só os produtos que atendem aos dois. Com `manager_id` e `unit_business_id` juntos, entram só as lojas que atendem aos dois. Todos os filtros valem também para a contagem de `warnings`.

### Quem é o gerente

O gerente é um contato (`/api/contacts`) com `type = "SELLER_MANAGER"` e com a loja dele em `unit_business_id`. Ele ganha a comissão de gerente de **todas as vendas com vendedor da loja dele**, inclusive as que ele mesmo vendeu: 30 vendas de vendedores na Loja 15 dão comissão de gerente das 30 para o gerente da Loja 15. Loja sem gerente cadastrado (ex.: Loja 21, Site) tem comissão de gerente **0**: ninguém recebe.

### Gerente regional

Gerente regional é um contato `SELLER_MANAGER` ligado a um **grupo de lojas** (`unit_business_group_id`, grupos de `/api/unit-business-group`). Ele ganha a comissão de gerente de todas as vendas das lojas do grupo, **a mais**: a comissão do gerente de cada loja continua igual. A taxa e o valor são os mesmos da comissão de gerente do item. Exemplo: gerente regional ligado ao grupo "Paraná" (lojas 11, 13, 16, 17, 20 e 24) ganha a comissão de gerente de cada venda dessas lojas, e o gerente da Loja 11 continua ganhando a dele. O regional ganha mesmo em loja do grupo sem gerente de loja (ex.: Loja 20): lá só ele recebe.

```http
PUT /api/contacts/:id
{ "type": "SELLER_MANAGER", "unit_business_group_id": "uuid-do-grupo" }
```

Para deixar de ser regional, mandar `"unit_business_group_id": null`. O mesmo contato pode ser gerente de uma loja (`unit_business_id`) e regional de um grupo ao mesmo tempo: ele ganha a comissão de gerente **uma vez por loja**, somando a loja dele e as do grupo. Gerente da Loja 01 com grupo 03, 04, 05 ganha pelas lojas 01, 03, 04 e 05. Gerente da Loja 01 com grupo 01, 02, 03 ganha pelas lojas 01, 02 e 03; na Loja 01 ele aparece só em `manager_name` (não em `regional_manager_name`), sem receber duas vezes.

Um regional pode não ser vendedor no Bling (ex.: Marcos Orlando, Regional 2): o contato não tem integração e `GET /api/integration-mapping/contact/:id` vem com `data` vazio.

#### Rotas de contatos

Todas exigem autenticação e permissão na tela de contatos.

| Rota | O que faz |
|---|---|
| `GET /api/contacts` | Lista paginada (`page`, `perPage`, `search` busca por nome). Filtros por campo: `filters[type]=SELLER_MANAGER` lista os gerentes; `filters[unit_business_id]=uuid` lista os contatos da loja; `filters[unit_business_group_id]=uuid` lista os gerentes regionais do grupo. Cada contato traz `unit_business_group_id` (`null` se não é regional) |
| `GET /api/contacts/:id` | Um contato |
| `POST /api/contacts` | Cria um contato |
| `PUT /api/contacts/:id` | Edita um contato (usar para marcar o gerente) |
| `DELETE /api/contacts/:id` | Remove um contato |
| `GET /api/integration-mapping/contact/:id` | Códigos do contato em cada integração (ver abaixo) |
| `GET /api/unit-business-group` | Grupos de lojas, para escolher o grupo do gerente regional (`GET /api/unit-business-group/:id` traz as lojas do grupo em `unitBusinesses`) |

Para tornar um vendedor gerente:

```http
PUT /api/contacts/:id
{ "type": "SELLER_MANAGER", "unit_business_id": "uuid-da-loja" }
```

A loja do gerente deve ser a mesma do cadastro desse vendedor no Bling: quando o cadastro do vendedor muda no Bling, a sincronização regrava `unit_business_id` com a loja de lá (ou vazio, se ele não tiver loja). O `type` nunca é sobrescrito.

Para voltar a ser só vendedor, mandar `"type": "SELLER"`. O gerente continua sendo vendedor: as vendas que ele fizer no Bling continuam com ele como vendedor. A lista de gerentes para o filtro sai de `GET /api/contacts?filters[type]=SELLER_MANAGER`.

#### Mapeamentos do contato: `GET /api/integration-mapping/contact/:id`

Códigos do vendedor/gerente em cada integração (por exemplo, o id dele no Bling e na Tecinco). Só leitura: os mapeamentos são criados pela sincronização. Aceita `page` e `perPage`; `:id` que não é UUID volta `400`.

```json
{
  "data": [
    {
      "id": "uuid",
      "entity_type": "CONTACT",
      "internal_id": "uuid-do-contato",
      "integrations_id": "uuid",
      "external_id": "15596862610",
      "is_primary": true,
      "erp_data": null,
      "createdAt": "2026-09-17T22:30:12.004Z",
      "updatedAt": "2026-09-17T22:30:12.004Z",
      "integration": { "id": "uuid", "name": "Bling" }
    }
  ],
  "meta": { "total": 2, "page": 1, "perPage": 20, "totalPages": 1, "hasNext": false, "hasPrev": false }
}
```

`external_id` é o código do contato naquela integração; `integration.name` é o nome a exibir.

Exemplo: `GET /api/seller-commission-report?start_date=2026-10-01&end_date=2026-10-31&seller_id=uuid`

### Resposta

`filters` repete os filtros recebidos (`null` quando não veio). O campo `stock_unit_business_id` saiu: a comissão não depende mais do estoque do CD21.

```json
{
  "filters": {
    "start_date": "2026-10-01",
    "end_date": "2026-10-31",
    "brand": null,
    "product_id": null,
    "seller_id": ["uuid"],
    "manager_id": null,
    "unit_business_id": null,
    "origin_unit_business_id": null
  },
  "rows": [
    {
      "order_item_id": "uuid",
      "order_id": "uuid",
      "store_name": "Loja 10 - Lins",
      "order_date": "2026-09-23",
      "order_number": "20503",
      "invoice_number": "019458",
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
      "manager_commission_value": 3.78,
      "regional_manager_name": "Gerente Regional",
      "regional_manager_commission_rate": 0.5,
      "regional_manager_commission_value": 3.78
    }
  ],
  "summary": {
    "orders_count": 456,
    "items_quantity": 1401,
    "total_value": 870185.43,
    "commission_base": 867680.06,
    "total_seller_commission": 4198.19,
    "total_manager_commission": 4198.19,
    "total_regional_manager_commission": 1520.4,
    "total_commission": 9916.78
  },
  "warnings": {
    "orders_open": 3,
    "orders_final_without_invoice": 1,
    "orders_missing_cost": 0
  }
}
```

### `rows[]`: uma linha por item do pedido

| Campo | Tipo | O que é |
|---|---|---|
| `order_item_id` | UUID | Id do item; usar como chave da linha |
| `order_id` | UUID | Id do pedido; vários itens do mesmo pedido repetem o valor |
| `store_name` | texto ou `null` | Loja da venda |
| `order_date` | `YYYY-MM-DD` | Data do pedido (é a data que o período filtra) |
| `order_number` | texto ou `null` | Número do pedido |
| `invoice_number` | texto | Número da nota de venda (todo pedido da comissão tem nota) |
| `seller_name` | texto ou `null` | Vendedor |
| `manager_name` | texto ou `null` | Gerente(s) da loja da venda (contatos `SELLER_MANAGER` daquela loja). Com mais de um gerente, os nomes vêm juntos, separados por `, `. `null` quando a loja não tem gerente cadastrado; nesse caso a comissão de gerente vem `0` |
| `customer_name` | texto ou `null` | Cliente |
| `brand` | texto ou `null` | Marca do produto |
| `product` | texto ou `null` | Nome do produto |
| `sku` | texto ou `null` | SKU do item no pedido |
| `quantity` | número | Quantidade vendida |
| `total_value` | número | Valor do item, antes do desconto do pedido |
| `commission_base` | número | Valor do item depois do desconto do pedido; é sobre ele que as duas comissões são calculadas |
| `seller_commission_rate` | número | Taxa da comissão do vendedor, em % |
| `seller_commission_value` | número | Comissão do vendedor, em R$ |
| `manager_commission_rate` | número | Taxa da comissão do gerente da loja, em %; `0` quando a loja não tem gerente |
| `manager_commission_value` | número | Comissão do gerente da loja, em R$; `0` quando a loja não tem gerente |
| `regional_manager_name` | texto ou `null` | Gerente(s) regional(is) da loja da venda (ver "Gerente regional"). Com mais de um, os nomes vêm separados por `, `. `null` quando a loja não está no grupo de nenhum regional, ou quando o regional do grupo já é o gerente daquela loja (já ganha em `manager_commission_value`) |
| `regional_manager_commission_rate` | número | Taxa da comissão do gerente regional, em % (a mesma taxa de gerente do item); `0` sem regional |
| `regional_manager_commission_value` | número | Comissão do gerente regional, em R$ (o mesmo valor de comissão de gerente do item, pago a mais); `0` sem regional |

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
| `total_regional_manager_commission` | **Total de comissão dos gerentes regionais** |
| `total_commission` | **Total de comissão**: vendedores + gerentes + regionais, o que a empresa paga no período |

### `warnings`: só contagem

Quantos pedidos do relatório de vendedores no período, com os mesmos filtros, ficaram fora da comissão, por motivo. Pedido cancelado não conta. Os problemas de nota fiscal × estoque (nota sem saída, cancelada sem devolução etc.) saíram daqui: estão no relatório de problemas de integração (seção 2), que lista tudo.

| Campo | O que conta | Texto sugerido |
|---|---|---|
| `orders_open` | Pedido Em aberto no Bling. Conta como venda no relatório de vendedores, sem comissão | Pedidos em aberto no Bling (sem comissão até faturar) |
| `orders_final_without_invoice` | Pedido Atendido, Enviado ou Entregue no Bling, mas sem nota de venda vinculada no sistema | Pedidos finalizados no Bling ainda sem nota fiscal de venda |
| `orders_missing_cost` | Pedido com produto sem custo médio. Não entra no relatório de vendedores | Pedidos com produto sem custo médio |

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

Quantidade de linhas por código, sempre com todos os códigos presentes (zero quando não há), e `total` com a soma. Ele lista todas as notas, inclusive marketplace e notas sem pedido. Os de devolução batem com os `warnings` do relatório de devolução sem filtros.

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

---

## 4. Mudança no relatório de vendedores: `GET /api/seller-report`

A comissão de gerente segue as mesmas regras do relatório de comissão (seção 1, "Quem é o gerente" e "Gerente regional"). Parâmetros e os demais campos continuam iguais.

- `summary.total_manager_commission`: passa a somar só as vendas de loja com gerente cadastrado. Loja sem gerente conta `0`.
- `summary.total_regional_manager_commission` (novo): total de comissão dos gerentes regionais.
- `managerCommissionByBrand[]`: `total_manager_commission` com a mesma regra, e `total_regional_manager_commission` (novo) por marca.

As duas comissões são só informativas: não entram em custo, markup nem contribuição (só a comissão do vendedor entra no custo, como antes). O quadro `byManager` não mudou.

```json
"summary": {
  "total_manager_commission": "3732.97",
  "total_regional_manager_commission": "3617.04"
},
"managerCommissionByBrand": [
  {
    "product_brand": "Continental",
    "total_revenue": "535700.65",
    "total_manager_commission": "2815.32",
    "total_regional_manager_commission": "2723.60"
  }
]
```

Nesse relatório os valores vêm como texto (`"3732.97"`), como os outros campos dele.

### O que mostrar

| Onde | Campo | Texto sugerido | O que muda na tela |
|---|---|---|---|
| Cards do resumo | `summary.total_manager_commission` | Comissão dos gerentes | Já existe; o valor fica menor quando o período tem venda de loja sem gerente (ex.: outubro/2026 passa de R$ 4.115,43 para R$ 3.732,97) |
| Cards do resumo | `summary.total_regional_manager_commission` | Comissão dos regionais | Card novo, ao lado de "Comissão dos gerentes" |
| Tabela de comissão de gerente por marca | `managerCommissionByBrand[].total_manager_commission` | Comissão gerentes | Já existe, com a mesma regra do card |
| Tabela de comissão de gerente por marca | `managerCommissionByBrand[].total_regional_manager_commission` | Comissão regionais | Coluna nova, ao lado de "Comissão gerentes" |

O card "Comissão dos regionais" mostra `0` quando o filtro não tem loja em grupo de regional (por exemplo, filtrando a Loja 21). Os campos de comissão do vendedor (`summary.total_commission`, `products[].commission_value` e os demais) não mudaram.
