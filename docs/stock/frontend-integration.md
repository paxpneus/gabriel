# Estoque reservado e disponível: contrato com o front

O estoque passou a trazer dois campos novos, **só para exibição**:

| Campo | O que é | Origem: Bling | Origem: Tecinco |
|---|---|---|---|
| `quantity` (já existia) | Estoque físico. É o único número que conta em inventário, totais e movimentações | `saldoFisicoTotal` | `estoque_fisico` |
| `reserved_quantity` | Quantidade reservada. Só existe reserva quando o físico e o virtual são diferentes; `0` = sem reserva | físico − virtual | físico − disponível |
| `virtual_stock` | Disponível: físico menos a reserva | `saldoVirtualTotal` | `estoque_disponivel` |

Cada campo é exibido com o próprio valor. Um não substitui o outro: não usar `virtual_stock` como fallback de `reserved_quantity`, nem o contrário. O front não faz conta com os campos novos e não envia nenhum deles. Nenhuma rota de escrita aceita esses campos.

Os dois podem vir `null` quando o estoque ainda não foi atualizado pela integração depois da mudança. Nesse caso, mostrar "-".

Todas as rotas exigem autenticação. Base: `/api`.

---

## 1. Produtos

Os campos entram em cada item do array `stocks` do produto, sempre como **número** ou `null`.

Rotas:
- `GET /products/:id/full`
- `GET /products/by-code/:code`
- `GET /products` (paginate)
- `GET /products/mapped/get`
- `GET /products/detailed/get`
- `GET /products/tire-search/paginated/get`: os campos ficam em `data[].product.stocks[]`

```json
"stocks": [
  {
    "id": "uuid",
    "quantity": 4,
    "unit_business_id": "uuid",
    "total_price": 1200,
    "reserved_quantity": 1,
    "virtual_stock": 3
  }
]
```

As outras rotas de produto (`GET /products/:id`, `/tire-search/get`) não mudaram.

---

## 2. Lote de inventário: `GET /inventory-batch/full/get`

Cada item em `items[]` ganha `reserved_quantity` e `virtual_stock`. Os dois vêm como **string decimal** (`"1.00"`) ou `null`, no mesmo formato de `quantity_stock`.

```json
"items": [
  {
    "quantity_stock": "4.00",
    "reserved_quantity": "1.00",
    "virtual_stock": "3.00",
    "stock": { "id": "uuid", "quantity": 4, "...": "..." }
  }
]
```

- `reserved_quantity` `"0.00"` = sem reserva (físico igual ao virtual). Mostrar como zero, não trocar por outro campo.
- `items[].stock` **não** traz `reserved_quantity` nem `virtual_stock`. Os valores a exibir são sempre os do item.

De onde vem o valor do item:
- **Lote FIXED**: guardado na criação do lote. Não muda depois.
- **Lote CYCLIC**: guardado quando o item entra no lote (bipagem ou inclusão manual). Enquanto o lote está aberto, é atualizado junto com `quantity_stock` quando a Bling sincroniza o estoque.
- **Lote de divergência**: herda o valor do item do lote original.

Itens criados antes da mudança vêm com `null`.

### Valores financeiros congelados

O preço e o custo médio do produto ficam guardados no item quando ele entra no lote. Mudança de preço depois disso não altera nada do lote.

```json
{
  "total_price": 12709.28,
  "total_entries": 0,
  "total_outputs": 794.33,
  "total_entries_average_cost": 0,
  "total_outputs_average_cost": 512.4,
  "items": [
    {
      "quantity_stock": "4.00",
      "unit_price": 794.33,
      "average_cost": "512.4000",
      "price": 3177.32
    }
  ]
}
```

| Campo | O que é |
|---|---|
| `items[].unit_price` (number) | Preço de venda unitário quando o item entrou no lote |
| `items[].average_cost` (string decimal ou `null`) | Custo médio unitário quando o item entrou no lote. `null` = produto sem custo médio |
| `items[].price` (number) | Valor do estoque do item: `unit_price × quantity_stock`. **Não muda mais na bipagem.** Antes virava `quantidade lida × preço da bipagem` |
| `total_price` | Soma de `items[].price` |
| `total_entries` / `total_outputs` | Divergência × `unit_price` (sobra / falta), pelo preço guardado e não pelo preço atual |
| `total_entries_average_cost` / `total_outputs_average_cost` (novos) | A mesma divergência valorizada pelo `average_cost` |

- Lote CYCLIC: quando a Bling sincroniza o estoque, `quantity_stock` muda, mas `price` continua com o valor de quando o item entrou no lote.
- Lote de divergência: herda `unit_price`, `average_cost` e `price` do item do lote original.
- O preço exibido deve ser o `unit_price` do item. Não usar `product.productConfigs[0].price`, que é o preço atual.

---

## 3. Mudança no `quantity` de lojas Tecinco

Nas lojas Tecinco, `quantity` passou a ser o estoque **físico** (`estoque_fisico`). Antes era o disponível. Produto com reserva no Tecinco vai mostrar um `quantity` maior a partir da próxima sincronização, e a reserva aparece separada em `reserved_quantity`.
