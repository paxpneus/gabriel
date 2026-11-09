# Transbordo e QR do romaneio: contrato com o front

**Transbordo** é quando a loja logada não é nem a emissora nem a destinatária da nota. Isso só é permitido em loja com `transshipment_allowed = true` (o CD). A carga passa pelo CD: ele **recebe** a nota (lote de entrada) e depois **expede** a mesma nota (lote de expedição).

O back marca isso sozinho, nota por nota, quando a nota entra no lote. Um mesmo lote pode ter notas da própria loja e notas de transbordo misturadas.

Todas as rotas exigem autenticação. Base: `/api`.

---

## 1. Romaneio: QR code no canto superior direito

O PDF continua sendo gerado no front. O que muda é um QR code novo no canto superior direito do cabeçalho.

- **Conteúdo do QR**: o `id` do lote do romaneio (`batch.id`), em texto puro. É um UUID só, então o QR fica pequeno e é lido em qualquer tamanho.
- **Onde colocar**: o QR fica no canto superior direito de **toda página**, porque o cabeçalho se repete. A faixa escura e os dois blocos (embarcadora/transportadora) precisam encolher na largura pra abrir espaço. Use um quadrado de 30 mm.

---

## 2. Nova rota: gerar lote bipando o QR

`POST /batch/from-qr-code`

A loja que bipa o QR de um romaneio de outra loja ganha um lote com as mesmas notas.

**Tela de entrada ou de expedição: mandar `type`.** Quando a tela já sabe o que a pessoa quer fazer, o front manda `type: "INCOMING"` ou `type: "OUTGOING"`, e o back respeita. Pedir expedição de nota de transbordo que ainda não tem lote de entrada finalizado na loja **dá erro** (`Nota X ainda não foi recebida nesta loja...`) e não cria nada. Nunca vira entrada.

**Sem `type`**, o back decide sozinho:

| A loja logada é... | Lote gerado |
|---|---|
| destinatária das notas | entrada |
| emissora das notas | expedição |
| transbordo (CD), e a nota ainda não tem lote de entrada nesta loja | entrada |
| transbordo (CD), e a nota já tem lote de entrada nesta loja | expedição |

**Expedição pelo QR**: nota destinada à própria loja termina ali e fica fora do lote de expedição. Exemplo: o romaneio da loja 17 tem uma nota para o CD e três para outras lojas. Na expedição, o CD bipa esse QR e o lote sai só com as três.

**Loja comum e romaneio do CD**: se o romaneio do CD tiver nota de outra loja, a leitura é bloqueada. A loja recebe pelo QR do romaneio da emissora. O romaneio do CD com notas de várias lojas se recebe pelo desktop ou bipando a chave de acesso das notas.

No CD, a mesma folha de romaneio serve pros dois momentos: na tela de entrada (`type: "INCOMING"`) na chegada, e na tela de expedição (`type: "OUTGOING"`) depois de finalizar a entrada.

**Body**

```json
{
  "batchId": "uuid lido do QR",
  "type": "OUTGOING",
  "mode": "REGULAR",
  "blingCheckJobId": "bling-invoice-items-check-..."
}
```

- `batchId`: obrigatório.
- `type`: opcional, `INCOMING` ou `OUTGOING`. Recomendado sempre que a tela for de entrada ou de expedição.
- `mode`: opcional, o mesmo de `POST /batch/generate-from-invoices`.
- `blingCheckJobId`: opcional, veja o §3.

A loja é sempre a do usuário logado.

**Resposta `201`**: o lote completo, no mesmo formato de `POST /batch/generate-from-invoices`. Se as notas já estavam num lote desse tipo nesta loja (bipou duas vezes), vem o lote que já existe.

**Erros `400`** (`{ "error": "..." }`, pode mostrar direto ao usuário):

| Mensagem | Quando |
|---|---|
| `QR do romaneio inválido` | O texto lido não é um id de lote |
| `Tipo de lote inválido. Use entrada ou expedição.` | `type` diferente de `INCOMING`/`OUTGOING` |
| `O QR lido não é de um romaneio de expedição.` | O lote não existe ou é de entrada |
| `Este romaneio é desta própria loja.` | O romaneio é da própria loja logada |
| `O romaneio lido não tem notas.` | O lote do romaneio está vazio |
| `As notas do romaneio não são do mesmo tipo de lote nesta loja: entrada 1001; expedição 1002.` | Só sem `type`: no CD, parte das notas de transbordo ainda não tem entrada e parte já tem |
| `As notas 1001, 1002 são de entrada nesta loja. Use a tela de entrada.` | Pediu expedição, mas todas as notas são recebidas pela loja |
| `As notas 1001 são de expedição nesta loja. Use a tela de expedição.` | Pediu entrada com nota emitida pela própria loja |
| `Nota 1001 ainda não foi recebida nesta loja. Finalize o lote de entrada antes de gerar o de expedição.` | CD pedindo expedição de nota de transbordo sem entrada finalizada na loja |
| `Leitura bloqueada: nota fiscal não pertence à sua unidade de negócio` | Loja sem transbordo bipando romaneio com nota de outra loja (ex.: romaneio do CD) |

Também valem os erros que a geração de lote já tinha: produto não mapeado, conciliação na Bling e pedido do PDV com erro crítico.

---

## 3. Fluxo da tela de bipar o QR

A trava de conciliação com a Bling continua valendo pra lote de entrada com nota da Bling. Como o front só tem o id do lote, ele busca as notas antes:

1. Bipa o QR e lê o `batchId`.
2. Busca as notas do romaneio com `GET /batch/full/get?batchId=<batchId>` e pega os `batchInvoices[].invoice_id`.
3. Chama `POST /batch/bling-reconciliation-check` com `{ "invoiceIds": [...] }`, como já é feito hoje na entrada:
   - `200` com `jobId: null`: não tem nota da Bling, vai direto pro passo 4 sem `blingCheckJobId`;
   - `202` com `jobId`: acompanha por `GET /batch/bling-reconciliation-check/:jobId` até terminar;
   - `409` com `syncing: true`: mostra a mensagem e pede pra tentar de novo depois.
4. Chama `POST /batch/from-qr-code` com `{ batchId, type, blingCheckJobId }`.

Na tela de expedição (`type: "OUTGOING"`) os passos 2 e 3 podem ser pulados: a conciliação Bling só vale pra entrada. Sem `type`, o front não sabe antes qual tipo vai sair, então o passo 3 roda sempre (em expedição o `blingCheckJobId` é ignorado).

---

## 4. Lote de transbordo sem QR (bipando a chave da nota)

As rotas de sempre continuam funcionando no CD: `POST /batch/generate-from-invoices` e `POST /batch/add-invoice`. O que muda pro front:

- **Escolher entrada ou expedição.** Na loja com `transshipment_allowed = true` (campo da unit business), o mesmo usuário monta lote de entrada e de expedição da mesma nota. A tela de montar lote do CD precisa deixar escolher o `type` (`INCOMING` ou `OUTGOING`). Nas outras lojas nada muda.
- **Ordem.** A expedição de uma nota de transbordo só sai depois que o lote de entrada dela, nesta loja, foi **finalizado**. Antes disso volta o erro `Nota X ainda não foi recebida nesta loja...` (vale também na bipagem de volumes).
- **Marca no lote.** Cada nota do lote passa a ter `batchInvoices[].is_transshipment` (`true`/`false`) em todas as rotas que devolvem o lote completo, inclusive a resposta de gerar lote e o `GET /batch/full/get`. Sugestão: mostrar um selo "Transbordo" nessas notas.
- **Marca na listagem de lotes.** `GET /batch` (listagens de lotes de expedição e de entrada) traz `has_transshipment` (`true`/`false`) em cada lote: `true` se alguma nota do lote é de transbordo. Serve pro selo "Transbordo" na linha do lote, sem buscar o lote completo.
- **Conferência na Tecinco.** É automática, como sempre, e as notas de transbordo ficam de fora. O front não faz nada.
- **Etiqueta de volume.** "Volume já lido" vale só dentro do mesmo lote. O CD bipa as mesmas etiquetas da emissora na entrada e na expedição.

---

## 5. Telas de nota na loja de transbordo

No CD, uma nota de transbordo tem **dois** registros, um de entrada e um de expedição. Cada um tem o próprio status e o próprio lote. Pra não misturar os dois:

- **Listagem** (`GET /invoice` e listagem de transferência): nas telas de entrada e de expedição do CD, sempre mandar `filters[type]=INCOMING` ou `filters[type]=OUTGOING`. Com isso, status, "lote gerado", lote e quantidade lida vêm do registro certo.
- **Detalhe** (`GET /invoice/full/:id`): no CD, mandar `?type=INCOMING` ou `?type=OUTGOING`, conforme a tela.

Sem o `type`, uma nota de transbordo pode mostrar os dados da entrada ou da expedição. Nas outras lojas o `type` continua opcional.

---

## 6. Relatório de operação diária

`GET /daily-operation-report`: mesma rota, campos novos.

- **`facts[]`**: dois contadores novos, `transshipment_incoming_count` e `transshipment_outgoing_count` (notas de transbordo do dia, sem as canceladas). As notas de transbordo **não entram** em nenhum outro número do dia: contagens, % concluído, cancelamento, tempos, adiantamentos e volumes. Mostrar os dois contadores à parte.
- **`snapshots[]`** (detalhamento): cada nota de transbordo do CD aparece em **duas** linhas, uma por `type`, com `is_transshipment: true`. Rótulos:
  - `type = INCOMING` e `is_transshipment = true` → **Entrada transbordo**
  - `type = OUTGOING` e `is_transshipment = true` → **Saída transbordo**
