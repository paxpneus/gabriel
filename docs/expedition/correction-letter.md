# Carta de correção e travas do lote: contrato com o front

**O caso:** o pedido foi lançado como ADT e a nota saiu pra logística própria (CD 12 ou 17). Mas o pedido era pra ir por transportadora. Nota emitida não se altera na Bling, então a loja emite uma **carta de correção** trocando a transportadora. Essa nota nunca vai ter nota de transferência. Sem a carta, ela trava o lote com:

`Nota(s) de venda sem número da nota de transferência: 022098. Vincule a nota de transferência (...) antes de gerar o romaneio.`

Pra destravar, anexe a carta de correção (PDF) na nota. O back confere se a carta é mesmo daquela nota. Daí em diante a nota passa no lote sem nota de transferência, e o romaneio pede uma justificativa.

Todas as rotas exigem login. Base: `/api`. Erro sempre vem como `{ "error": "mensagem" }`. A mensagem já está pronta pra mostrar ao usuário.

---

## 1. Finalizar lote: mesmas travas do romaneio

`PUT /batch/finish/:batchId`: mesma rota e mesmo body. Agora ela pode devolver `400` com estes erros. Quando isso acontece, o lote **não** é finalizado.

- **Lote de saída CD 12/17** com nota sem transferência:
  `Nota(s) de venda sem número da nota de transferência: 022098. Vincule a nota de transferência (ou anexe a carta de correção da nota, se ela devia ter ido por transportadora) antes de finalizar o lote.`
  Também aparecem as outras variações que o romaneio já tinha, como transferência não encontrada no sistema.
- **Pedido PDV com erro crítico:** `Pedido da(s) nota(s) <números> tem erros críticos — ajuste no quadro PDV antes de gerar lote/romaneio`.

Lote de entrada não passa pela trava de transferência.

No romaneio, a mensagem de transferência também passou a sugerir a carta de correção. Lá ela termina em "antes de gerar o romaneio.".

---

## 2. Anexar carta de correção na nota

`POST /invoice/:id/correction-letter`

- `:id`: id da nota. No lote, é `batchInvoices[].invoice_id`.
- Body: `multipart/form-data` com o campo **`file`**, sempre em **PDF**.
- Permissão: a mesma de editar notas.

O back lê o PDF e confere três coisas: o PDF precisa ser uma carta de correção, ter a chave de acesso dessa nota e trazer o mesmo número (`NF-e Nº ...`). Anexar de novo **substitui** a carta anterior.

**200**

```json
{
  "id": "uuid",
  "number_system": "022307",
  "correction_letter_path": "temp://... | /cartas-correcao/carta_correcao_022307_10-11-2026_14-32-05.pdf",
  "correction_letter_attached_at": "2026-11-10T17:32:05.000Z"
}
```

**Erros**

| Status | `error` |
|---|---|
| 400 | `Envie o PDF da carta de correção.` (sem arquivo) |
| 400 | `Envie a carta de correção em PDF.` |
| 400 | `O arquivo enviado não é uma carta de correção.` |
| 400 | `Não foi possível ler a chave de acesso e o número da nota na carta de correção.` (PDF escaneado ou foto, sem texto selecionável) |
| 400 | `A nota da carta de correção (nº 022307) não foi encontrada no sistema.` |
| 400 | `A carta de correção enviada é da nota 022307, não da nota 022098.` |
| 400 | `O número da nota na carta de correção (022307) não confere com a nota 022098.` |
| 404 | `Nota fiscal não encontrada` |

**Onde mostrar:** quando finalizar o lote ou gerar o romaneio falhar por falta de transferência, ofereça "Anexar carta de correção" em cada nota citada. Depois de anexar, é só tentar de novo.

### Campos novos na nota

Vêm em `GET /invoice/:id`, em `GET /invoice/full/:id` e no lote completo (`batchInvoices[].invoice`). A listagem `GET /invoice` não traz esses campos.

- `correction_letter_path`: `null` quando a nota não tem carta. Qualquer valor preenchido significa **carta anexada**. Enquanto o arquivo sobe pra nuvem, o valor começa com `temp://`; o front não precisa tratar isso de forma diferente.
- `correction_letter_attached_at`: data em que a carta foi anexada pela última vez.

### Baixar a carta

`GET /invoice/:id/correction-letter`: devolve o PDF (`Content-Type: application/pdf`, `inline`, com o nome do arquivo da nuvem, ex. `carta_correcao_022307_10-11-2026_14-32-05.pdf`). Funciona igual ao DANFE: abrir em nova aba ou baixar como blob. Permissão: a mesma de ver notas.

Funciona logo depois de anexar, mesmo antes de o arquivo terminar de subir pra nuvem.

| Status | `error` |
|---|---|
| 404 | `Nota fiscal não encontrada` |
| 404 | `A nota não tem carta de correção anexada.` |

---

## 3. Gerar romaneio: justificativa da carta de correção

Se alguma nota do lote tem carta de correção, o romaneio exige uma **justificativa** explicando o motivo da carta. Ela é pedida uma vez e fica salva no lote. Se a justificativa for enviada de novo depois, substitui a anterior.

**Campo novo no lote** (lote completo): `correction_letter_justification` (texto ou `null`).

**Quando pedir:** antes de chamar o romaneio, abra um campo de justificativa se as duas condições valerem:
- `batchInvoices.some(bi => bi.invoice.correction_letter_path)`;
- `correction_letter_justification` do lote está vazio.

Se o front não pedir, o back recusa com o erro abaixo, e aí o front pede a justificativa e tenta de novo.

**Rota normal:** `GET /batch/delivery-note/get?batchId=...&userId=...&correctionLetterJustification=...`
**PDV:** `POST /batch/pdv-sales-requests/delivery-note`, com o campo novo no body:

```json
{
  "status": "SHIPPING",
  "operator_id": "uuid",
  "correction_letter_justification": "Pedido era por transportadora; NF emitida para CD 12 por engano, corrigida por CC-e."
}
```

No PDV, a mesma justificativa vale pra todos os lotes que o romaneio gerar.

### Justificativas prontas

`GET /batch/correction-letter/justifications`: lista de justificativas prontas pra agilizar o preenchimento. Exige só login, então funciona na tela normal e na do CD21.

```json
[
  {
    "code": "WRONG_CARRIER",
    "label": "Transportadora errada",
    "template": "Nota emitida para a transportadora errada: foi emitida para a transportadora própria, mas era para ter ido por transportadora externa. Carta de correção atrelada à nota {notas}."
  }
]
```

O front troca `{notas}` pelos números das notas com carta de correção (ex. `022307` ou `022307, 022308`) e manda o texto final no mesmo campo da justificativa (`correctionLetterJustification` / `correction_letter_justification`). O usuário pode editar o texto ou escrever outro. O back não valida se o texto veio de uma opção pronta.

**Erro** (400, nada é gravado):
`Nota(s) com carta de correção: 022307. Informe a justificativa da carta de correção para gerar o romaneio.`

A justificativa entra no histórico do lote (`GET /batch/:id/audit-logs`) como "Justificativa da carta de correção".

---

## 4. Histórico da nota

`GET /invoice/:id/audit-logs`: mesmo contrato do histórico de lote e de produto. É paginado (`page`, `perPage` até 100, `filters[action]=CREATE|UPDATE|DELETE`) e devolve `{ data, meta }`. Por enquanto só registra a carta de correção anexada ou substituída, com a `description` pronta pra exibir:

`Nota fiscal alterado — Carta de correção anexada na nota 022307, corrigindo a falta da nota de transferência: o pedido devia ter ido por transportadora, então a nota segue no lote e no romaneio sem nota de transferência. — Alterações: Carta de correção anexada em: — → 10/11/2026, 14:32:05`

Erros: `404` quando a nota não existe e `400` quando o id é inválido.
