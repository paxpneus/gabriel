# Nota interna: contrato com o front

**Nota interna** é a nota de série B da Tecinco. Ela é sempre uma transferência entre lojas próprias e **não tem chave de acesso nem XML**. O back importa sozinho pelo sync da Tecinco: uma nota só, com a loja emissora (saída) e a loja destinatária (entrada).

Regra geral: **a nota interna sai de todas as telas e ações atuais de nota e de lote, e só aparece nas rotas novas `/api/invoice/internal/...`**. Para nota que não é interna, nada muda.

Todas as rotas exigem autenticação. Base: `/api`.

---

## 1. O que muda nas telas atuais

### Listagens

| Onde | O que muda |
|---|---|
| `GET /invoice` (listagem geral) | Não traz mais nota interna |
| `GET /invoice/transfer/list` | Não traz mais nota interna |
| `GET /invoice/report/transfer`, relatório de produto e de fornecedor | Não trazem mais nota interna |
| Relatórios de venda × transferência, problemas de integração, devolução de venda, fluxo de estoque e operação diária | Não contam mais nota interna |
| Kardex (movimentação de estoque) | Não usa mais nota interna |
| PDV: busca de nota de transferência para a venda | Não traz mais nota interna |

**Filtro por operação** (`filters[invoice_operation_id]`, opções de `GET /invoice-operation`): na listagem geral, a opção "Transferência interna" (code `50`) agora volta sempre vazia. **Tirar essa opção do filtro das telas atuais.** A nota interna tem a tela própria (§2).

### Ações em nota que recusam nota interna

Mandar uma nota interna para estas ações dá erro `400`/`500` com a mensagem **`Nota interna: use a tela de nota interna.`** (a mensagem traz os números das notas entre colchetes):

- `POST /invoice/bulk/open`, `POST /invoice/bulk/mark-internal-use`, `POST /invoice/:id/finish`
- `PUT /invoice/:id` e a atualização em massa
- carta de correção (anexar e baixar), DANFE (individual e em lote), etiqueta
- PDV: anexar nota interna como transferência da venda. A mensagem é `Nota interna não serve como nota de transferência da venda.`

O ideal é o front não oferecer essas ações para nota interna. Como ela não aparece mais nas listagens atuais, isso já acontece naturalmente.

**Continua igual para nota interna:** agendamento, `PUT /invoice/schedule/invoice/:id` (§3).

### Lote (expedição)

- **`GET /batch`**: por padrão, traz **só lote de NF-e**. Com `filters[is_internal]=true`, traz **só lote interno**. Todo lote agora tem o campo `is_internal` (boolean) na resposta.
- **`POST /batch/generate-from-invoices`** e **`POST /batch/from-qr-code`** com nota interna: erro `Nota interna: use a tela de nota interna.`.
- **Rotas atuais que recusam lote interno**, com o erro **`Lote de nota interna: use a tela de nota interna.`**:
  - `POST /batch/add-invoice` e `POST /batch/add-invoice-to-last-outgoing-batch` (o lote interno recebe nota pela rota própria, §2.3);
  - `PUT /batch/finish/:batchId` (o lote interno é finalizado pela rota própria, §2.7);
  - romaneio (`/batch/delivery-note/get`);
  - `DELETE /batch-invoices/remove/:id` (tirar nota do lote; no lote interno, rota própria, §2.4);
  - toda bipagem atual em `/scan-logs/...`: `scan/product`, `scan/product/incoming`, as rotas `.../by-invoice`, `bulk-remove-logs` e `bulk-remove-logs-incoming`.
- **Excluir lote** (`DELETE /batch/:id` e em massa): aceita lote interno, com a mesma regra do lote de NF-e, que **só exclui lote vazio** (tirar as notas antes pela §2.4).
- Lotes de saída pendentes (busca de lote pendente, CD21, PDV) não trazem lote interno.
- Detalhe e relatório do lote (`GET /batch/:id`, `/batch/full/get`, `/batch/report/get`, `/batch/is-complete/:batchId`) funcionam igual para lote interno.

---

## 2. Rotas novas

### 2.1 Listar notas internas

`GET /invoice/internal/list`

São os mesmos parâmetros (`page`, `perPage`, `search`, `filters[...]`, ordenação) e o mesmo formato de resposta paginada de `GET /invoice/transfer/list`. A diferença é que esta lista traz só nota interna.

- Loja: `filters[unit_business_id]` ou `unitBusinessId` na query. **Sem loja, traz as notas internas de todas as lojas**, igual ao `/transfer/list`.
- Para status e lote de cada loja, mandar `filters[type]=OUTGOING` (tela de saída) ou `filters[type]=INCOMING` (tela de entrada).
- `sender_unit_business_name` / `receiver_unit_business_name`: nome da loja emissora e da destinatária (`null` se o CNPJ não for de loja). O detalhe `GET /invoice/full/:id` também devolve esses dois campos, para qualquer nota.
- Diferenças nos campos: `xml_key` vem sempre `null` e a série é `B`. O `number_system` é o número da nota na Tecinco, o mesmo na saída e na entrada.

### 2.2 Gerar lote interno

`POST /invoice/internal/batch/generate`

```json
{
  "invoiceIds": ["uuid", "uuid"],
  "type": "OUTGOING",
  "mode": "REGULAR",
  "unitBusinessId": "uuid opcional"
}
```

- `invoiceIds`: obrigatório, ao menos 1.
- `type`: `OUTGOING` (saída) ou `INCOMING` (entrada).
- `mode`: o mesmo de `POST /batch/generate-from-invoices`.
- `unitBusinessId`: opcional. Sem ele, vale a loja do usuário logado.

O resto das regras é o mesmo da geração atual de lote.

**Resposta `201`:** o lote criado, com `is_internal: true`.

**Erros:**
- `400`: `Informe ao menos uma nota interna`.
- `500`, com `{ "error": "..." }`:
  - `Só nota interna neste lote` (veio nota que não é interna);
  - as mesmas validações da geração atual (produto não mapeado etc.).

### 2.3 Adicionar nota interna ao lote

`POST /invoice/internal/batch/add-invoice`

Igual ao `POST /batch/add-invoice`, mas a nota vai pelo **id** (a nota interna não tem chave de acesso).

```json
{
  "invoiceIds": ["uuid", "uuid"],
  "type": "OUTGOING",
  "batchId": "uuid opcional",
  "unitBusinessId": "uuid opcional"
}
```

- `batchId`: lote interno aberto que recebe as notas. Sem ele, cria um lote interno novo.
- `unitBusinessId`: opcional. Sem ele, vale a loja do usuário logado.

**Resposta `201`:** o lote completo, como no `add-invoice` atual.

**Erros:**
- `400`: `Informe ao menos uma nota interna`.
- `500`, com `{ "error": "..." }`:
  - `Só nota interna neste lote` (veio nota que não é interna);
  - `Lote não é de nota interna` (`batchId` de lote de NF-e);
  - as mesmas validações do `add-invoice` atual (lote finalizado, nota em outro lote, transportadoras diferentes, produto não mapeado etc.).

### 2.4 Tirar nota do lote interno

`DELETE /invoice/internal/batch/invoice/:id`

Igual ao `DELETE /batch-invoices/remove/:id`: `:id` é o id da nota no lote (`batchInvoices[].id` do detalhe do lote). As bipagens dessa nota no lote são apagadas e a nota volta a ficar sem lote.

**Resposta `201`:** `{ "message": "Nota removida com sucesso!" }`

**Erros `400`**, com `{ "error": "..." }`:
- `Lote não é de nota interna` (para lote de NF-e, usar a rota atual);
- as mesmas validações do remover atual (lote finalizado etc.).

### 2.5 Bipar produto

`POST /invoice/internal/batch/scan/outgoing` (lote de saída)
`POST /invoice/internal/batch/scan/incoming` (lote de entrada)

```json
{
  "productcode": "7891234567890",
  "batchId": "uuid",
  "quantity": 1
}
```

- **Sem etiqueta de volume.** A nota interna não tem XML, então não tem volume. Bipa-se só o EAN (ou código) do produto.
- `quantity`: opcional, padrão `1`. Precisa ser inteiro maior que zero, para bipar várias unidades de uma vez.
- O back reparte a quantidade entre as notas do lote que ainda têm esse produto a ler, na ordem em que entraram no lote:
  - **na saída**, passar do que falta é erro;
  - **na entrada**, a sobra fica na última nota, igual à entrada atual.

**Resposta `201`:** `{ "message": "Produto escaneado com sucesso" }`, a mesma da bipagem atual.

**Erros `400`**, com `{ "error": "..." }`:
- `Lote não encontrado`
- `Lote não é de nota interna`
- `Lote não é de saída` / `Lote não é de entrada` (rota errada para o tipo do lote)
- `Lote já finalizado`
- `Produto não encontrado!`
- `Produto não está nas notas deste lote`
- `Quantidade inválida`
- `Quantidade informada (N) excede o restante a bipar (M)` (só na saída)

**Não há remoção de bipagem para lote interno.** As rotas atuais de remover bipagem recusam lote interno.

### 2.6 O que falta bipar de um item

`GET /invoice/internal/batch/pending/:batchItemId`

Substitui o `GET /scan-logs/pending-volumes/:batchItemId`, que mostra volumes do XML, para lote interno. O `batchItemId` vem dos itens do detalhe do lote.

**Resposta `200`:**

```json
{
  "data": [
    { "productName": "PNEU 175/70R13 ...", "invoiceNumberSystem": "882", "pendingQuantity": 2 }
  ]
}
```

É uma linha por nota do lote que ainda tem esse produto a ler.

### 2.7 Finalizar lote interno

`POST /invoice/internal/batch/:batchId/finish`

```json
{ "justification": "texto opcional, mesmo uso do finalizar atual" }
```

As regras são as do finalizar atual (`PUT /batch/finish/:batchId`), inclusive a conferência de estoque na Tecinco.

**Resposta `200`:** `"Lote finalizado com sucesso!"`

**Erros `400`**, com `{ "error": "..." }`:
- `Lote não é de nota interna` (para lote de NF-e, usar a rota atual);
- as mesmas validações do finalizar atual.

### 2.8 Listar lotes internos

Não tem rota nova: é `GET /batch?filters[is_internal]=true`, com os mesmos parâmetros e a mesma resposta da listagem atual.

---

## 3. Fluxo da tela de nota interna

1. **Lista:** `GET /invoice/internal/list` com `filters[type]` da tela (saída ou entrada) e a loja.
2. **Status:**
   - na loja emissora (saída), a nota nasce **Aberta**;
   - na loja destinatária (entrada), a nota nasce **Aguardando agendamento** e é agendada pela rota atual, `PUT /invoice/schedule/invoice/:id`;
   - se a nota for cancelada na Tecinco, o sync marca **Cancelada** sozinho e tira a nota do lote, se ela estiver em algum.
3. **Gerar lote:** selecionar as notas e chamar `POST /invoice/internal/batch/generate`. Para incluir ou tirar nota de um lote aberto: `.../batch/add-invoice` e `.../batch/invoice/:id`.
4. **Bipar:** abrir o lote (detalhe atual) e bipar por `.../scan/outgoing` ou `.../scan/incoming`. O que falta bipar sai de `.../pending/:batchItemId`.
5. **Finalizar:** `POST /invoice/internal/batch/:batchId/finish`.
6. **Lotes internos:** `GET /batch?filters[is_internal]=true`.

**Não existe para nota interna:** cancelar lote, remover bipagem, romaneio, DANFE, etiqueta e carta de correção.
