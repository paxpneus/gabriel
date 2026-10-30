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

---

## 3. Mudança no `quantity` de lojas Tecinco

Nas lojas Tecinco, `quantity` passou a ser o estoque **físico** (`estoque_fisico`). Antes era o disponível. Produto com reserva no Tecinco vai mostrar um `quantity` maior a partir da próxima sincronização, e a reserva aparece separada em `reserved_quantity`.
