# Import manual — contrato com o front

Importa produto, nota fiscal ou pedido de uma integração (Bling ou Tecinco) sob demanda.

Antes do fluxo, a tela carrega as opções em `GET /api/manual-import/options`: quais integrações existem, que entidades cada uma aceita e por quais campos dá pra buscar.

O fluxo tem 3 passos:

1. **Busca** (`POST /api/manual-import`): o back consulta a API da integração e devolve o que achou. **A busca nunca importa nada.**
   - 0 resultados: avisa que não achou.
   - 1 ou mais resultados: devolve a lista pro usuário conferir e escolher. Vale também quando só 1 registro foi encontrado: o usuário vê o dado antes e, se for o errado, não importa.
2. **Escolha** (`POST /api/manual-import/confirm`): envia os itens marcados da lista, no máximo 10. **É sempre aqui que o import começa.**
3. **Andamento** (`GET /api/manual-import/status`): consulta periódica até o import terminar (ex.: "5/10").

Todas as rotas exigem autenticação (cookie/bearer do usuário ou credencial de application). Não há permissão específica.

---

## 0. Opções — `GET /api/manual-import/options`

Monta a tela: seletor de integração → entidade → tipo de busca. Chamar ao abrir a tela. A resposta é a fonte de verdade do que é aceito (a tabela da seção seguinte só ilustra). Entidade ou busca que não aparece aqui volta 400 `UNSUPPORTED_SEARCH`.

### Resposta — `200`
```json
{
  "maxItems": 10,
  "integrations": [
    {
      "integrationId": "3f1c…-uuid",
      "name": "Bling",
      "entities": [
        {
          "entity": "product",
          "label": "Produto",
          "searchBy": [
            { "by": "id", "label": "ID na integração" },
            { "by": "name", "label": "Nome" },
            { "by": "local_id", "label": "ID no sistema" }
          ]
        },
        {
          "entity": "invoice",
          "label": "Nota fiscal",
          "searchBy": [
            { "by": "id", "label": "ID na integração" },
            { "by": "number", "label": "Número" },
            { "by": "local_id", "label": "ID no sistema" }
          ]
        },
        {
          "entity": "order",
          "label": "Pedido",
          "searchBy": [
            { "by": "id", "label": "ID na integração" },
            { "by": "number", "label": "Número" },
            { "by": "local_id", "label": "ID no sistema" }
          ]
        }
      ]
    },
    {
      "integrationId": "8a2b…-uuid",
      "name": "Tecinco",
      "entities": [
        {
          "entity": "product",
          "label": "Produto",
          "searchBy": [
            { "by": "id", "label": "ID na integração" },
            { "by": "name", "label": "Nome" },
            { "by": "local_id", "label": "ID no sistema" }
          ]
        },
        {
          "entity": "invoice",
          "label": "Nota fiscal",
          "searchBy": [
            { "by": "access_key", "label": "Chave de acesso (44 dígitos)" },
            { "by": "local_id", "label": "ID no sistema" }
          ]
        }
      ]
    }
  ]
}
```
- Usar `integrationId`, `entity` e `by` daqui direto no body da busca; `name`/`label` são só pra exibir.
- Integração que não está configurada no ambiente não aparece.
- `maxItems` é o mesmo limite do `/status` (seleção máxima no confirm).

---

## Integrações e buscas suportadas

O mesmo que o `/options` devolve hoje, com o que vai em `value`. `integrationId` é o id de cada integração no `/options`.

| Integração | `entity` | `by` aceitos | O que vai em `value` |
|---|---|---|---|
| Bling | `product` | `id`, `name`, `local_id` | id do produto na Bling / parte do nome / id local |
| Bling | `invoice` | `id`, `number`, `local_id` | id da nota na Bling / número da nota / id local |
| Bling | `order` | `id`, `number`, `local_id` | id do pedido na Bling / número do pedido / id local |
| Tecinco | `product` | `id`, `name`, `local_id` | código do produto na Tecinco / parte do nome / id local |
| Tecinco | `invoice` | `access_key`, `local_id` | chave de acesso (44 dígitos; espaços e pontos são ignorados) / id local |

- **Nota da Bling:** só nota de venda (NF-e de saída). NFC-e não é buscada. NF-e de entrada achada por id volta na lista como não importável.
- **`local_id`:** id (UUID) de um registro que já existe no sistema, pra buscar de novo os dados dele na integração. Se o registro não existe ou não é daquela integração, a resposta é 422.
- Uma entidade e um valor por busca.
- Combinação fora da tabela → 400 `UNSUPPORTED_SEARCH`.

---

## 1. Busca — `POST /api/manual-import`

### Request
```json
{
  "integrationId": "3f1c…-uuid",
  "entity": "product",
  "by": "name",
  "value": "205/55R16"
}
```

### Respostas

A resposta depende de quantos resultados a integração devolveu (`outcome`).

**0 resultados — `200`**
```json
{ "outcome": "NOT_FOUND" }
```

**1 ou mais resultados — `200`, o usuário confere e escolhe**

Mesmo com um resultado só, a resposta é a lista (com 1 item). Nada foi importado ainda.

```json
{
  "outcome": "CHOOSE",
  "truncated": false,
  "warnings": [],
  "results": [
    {
      "externalId": "900",
      "label": "ABC123 - PNEU 205/55R16 …",
      "details": { "name": "PNEU 205/55R16 …", "ean": "789…", "code": "ABC123", "status": null },
      "importable": true,
      "existsLocally": true,
      "localId": "uuid-do-produto",
      "alreadyProcessing": null
    },
    {
      "externalId": "901",
      "label": "…",
      "details": { "...": "..." },
      "importable": false,
      "reason": "Nota anterior ao corte (2025-07-01)",
      "existsLocally": false,
      "localId": null,
      "alreadyProcessing": { "id": "uuid", "type": "user", "name": "João" }
    }
  ]
}
```
- `truncated: true`: a integração tinha mais resultados que os 100 da primeira página. Sugerir ao usuário refinar a busca.
- `existsLocally: true`: marcar na lista que esse item vai ser **atualizado**, não criado.
- `importable: false`: desabilitar o item e mostrar o `reason`.
- `alreadyProcessing` preenchido: outra pessoa está importando esse item agora. Mostrar o nome. Se ele for enviado mesmo assim, volta `ALREADY_PROCESSING` no confirm.
- A lista fica válida por **30 minutos**. Depois disso o confirm devolve `SEARCH_EXPIRED` e é preciso buscar de novo.

### Details (dados de exibição por entidade)

Todos os campos podem vir `null`.

| Entidade | Campos |
|---|---|
| `product` | `name`, `ean`, `code` (código/SKU), `status` (situação na integração) |
| `invoice` | `number`, `series`, `model` (`"NF-e"` \| `"NFC-e"`), `type` (`"IN"` entrada \| `"OUT"` saída), `issuedAt`, `contact`, `status` |
| `order` | `number`, `storeNumber` (número na loja/marketplace), `date`, `contact`, `status` (nome da situação) |

`label` é um texto curto pronto pra exibir (ex.: `"NF-e 4521"`, `"Pedido 1203"`, `"ABC123 - PNEU …"`).

---

## 2. Escolha — `POST /api/manual-import/confirm`

Depois de toda busca que devolveu `CHOOSE` (inclusive com 1 resultado). Os `externalIds` têm que ser da lista dessa busca, feita pelo mesmo usuário nos últimos 30 minutos.

### Request
```json
{
  "integrationId": "3f1c…-uuid",
  "entity": "order",
  "externalIds": ["1", "2", "3"]
}
```
No máximo **10** ids. Ids repetidos são ignorados.

### Respostas

**Pelo menos um item entrou na fila — `202`**
```json
{
  "run": { "...": "ver Run" },
  "items": [
    {
      "externalId": "1",
      "label": "Pedido 1",
      "status": "ALREADY_PROCESSING",
      "processingBy": { "id": "uuid", "type": "user", "name": "Maria" },
      "warnings": []
    },
    { "externalId": "2", "label": "Pedido 2", "status": "ENQUEUED", "warnings": [] },
    {
      "externalId": "3",
      "label": "Pedido 3",
      "status": "ENQUEUED",
      "warnings": [ { "code": "ALREADY_EXISTS_UPDATING", "message": "Registro já existente no sistema, atualizando" } ]
    }
  ],
  "warnings": []
}
```

**Nenhum item entrou na fila — `200`**

Mesmo formato, sem `run`. Nenhum import começou e o usuário não fica bloqueado.
```json
{ "items": [ { "externalId": "1", "label": null, "status": "SEARCH_EXPIRED", "reason": "Busca expirada ou inexistente — busque novamente", "warnings": [] } ], "warnings": [] }
```

`items` vem na mesma ordem dos `externalIds` enviados.

### `status` de cada item

| `status` | Significado | O que mostrar |
|---|---|---|
| `ENQUEUED` | Entrou na fila | Acompanhar pelo `/status` |
| `SEARCH_EXPIRED` | Não veio de uma busca deste usuário, ou a busca passou de 30 min | Pedir pra buscar de novo |
| `NOT_IMPORTABLE` | Não pode ser importado | `reason` |
| `ALREADY_PROCESSING` | Outra pessoa está importando esse item agora | `processingBy.name` |
| `ENQUEUE_FAILED` | Erro ao colocar na fila (raro) | `reason`; pode tentar de novo |

Um item recusado não impede os outros. Ex.: o usuário manda os pedidos 1, 2 e 3 e só o 1 está com outra pessoa: o 1 volta `ALREADY_PROCESSING` e o 2 e o 3 são importados.

---

## 3. Andamento — `GET /api/manual-import/status`

Chamar:
- ao abrir a tela, pra já abrir bloqueada se o usuário tiver import rodando e pra mostrar o aviso de outros imports;
- a cada ~3s enquanto `run.status === "RUNNING"`, parando quando virar `"FINISHED"`.

Não há requisição pendurada: cada chamada calcula o andamento na hora.

### Resposta — `200`
```json
{
  "run": {
    "runId": "uuid",
    "status": "RUNNING",
    "integrationId": "3f1c…-uuid",
    "entity": "order",
    "total": 10,
    "done": 5,
    "completed": 4,
    "failed": 1,
    "startedAt": "2026-10-15T13:02:11.000Z",
    "finishedAt": "2026-10-15T13:04:40.000Z",
    "items": [
      { "externalId": "2", "label": "Pedido 2", "existsLocally": false, "status": "completed", "result": "IMPORTED" },
      { "externalId": "3", "label": "Pedido 3", "existsLocally": true,  "status": "failed", "error": "Bling respondeu 500" },
      { "externalId": "4", "label": "Pedido 4", "existsLocally": false, "status": "waiting" }
    ]
  },
  "othersRunning": { "3f1c…-uuid": false, "8a2b…-uuid": true },
  "maxItems": 10
}
```

- `run`: import atual ou o último do usuário, guardado por 7 dias. Vem `null` se não houver nenhum.
- `finishedAt` só aparece com `status: "FINISHED"`.
- `run.items` lista só os itens que entraram na fila.
- **Progresso:** `done/total` (ex.: "5/10"), com `done = completed + failed`.
- `run.status === "RUNNING"`: **bloquear novos imports** (busca e confirm). Senão eles voltam 409.
- `othersRunning[integrationId] === true`: há import manual de outra pessoa nessa integração. Mostrar o aviso de que pode demorar, inclusive antes de o usuário enviar. Não bloqueia.
- `maxItems`: limite de seleção na lista (10).

### `status` de cada item no andamento

| `status` | Significado |
|---|---|
| `waiting` | Na fila, ainda não começou |
| `active` | Processando |
| `delayed` | Aguardando nova tentativa automática (erro temporário). Ainda conta como pendente |
| `completed` | Concluído. Ver `result` |
| `failed` | Falhou de vez. Ver `error` |
| `not_found` | Job sumiu da fila. Tratar como falha |
| `unknown` | Estado inesperado. Tratar como pendente |

**`result`** (só em `completed`):
- `IMPORTED`: processado normalmente.
- `IGNORED_NO_TIRE_ITEMS`: só em nota da Tecinco. A nota não tem item de pneu e por isso não foi importada. Não é erro, mas vale avisar o usuário.

> **Produto da Bling sem vínculo no sistema:** o job conclui com `IMPORTED`, mas o produto não é criado. Ele vai pra fila de **produtos não mapeados**, pra revisão manual, igual ao que acontece no sync automático.

---

## Avisos (`warnings`)

Os avisos não bloqueiam nada: só mostrar.

| `code` | Quando | Onde |
|---|---|---|
| `ALREADY_EXISTS_UPDATING` | O registro já existe no sistema e vai ser atualizado | `warnings` do item no confirm (na lista da busca isso vem como `existsLocally: true`) |
| `OTHER_MANUAL_IMPORTS_RUNNING` | Há import manual em andamento nessa integração, então pode demorar | `warnings` geral da busca e do confirm |

Todo aviso traz `{ code, message }`. A `message` já vem em português, pronta pra exibir.

---

## Erros

Formato: `{ "code": "...", "message": "...", ...extras }`.

| HTTP | `code` | Quando | Extras |
|---|---|---|---|
| 400 | `MAX_ITEMS_EXCEEDED` | confirm com mais de 10 ids | `max: 10` |
| 400 | `UNSUPPORTED_SEARCH` | combinação integração/entidade/`by` fora da tabela | `supported: string[]` (buscas aceitas pra entidade) |
| 400 | `INTEGRATION_NOT_SUPPORTED` | integração sem import manual | — |
| 400 | `INVALID_SEARCH_VALUE` | id da Bling não numérico, ou chave de acesso sem 44 dígitos | — |
| 409 | `USER_IMPORT_RUNNING` | o usuário já tem um import rodando (busca ou confirm) | `run` (mesmo formato do `/status`; pode vir `null` por um instante) |
| 422 | `LOCAL_RECORD_NOT_LINKED` | `by: "local_id"` de registro inexistente ou de outra integração | — |
| 502 | `INTEGRATION_REQUEST_FAILED` | a API da Bling/Tecinco respondeu erro | `error` (mensagem da integração) |
| 500 | — | erro inesperado | `error` |

**Validação do body** (campo faltando, `integrationId` não é UUID, `entity`/`by` inválidos, `local_id` não é UUID, `externalIds` vazio): `400` no formato padrão da API.
```json
{ "success": false, "message": "Erro na validação dos dados", "errors": [ { "field": "value", "message": "…", "code": "custom" } ] }
```

---

## Regras pro front, resumidas

0. Ao abrir a tela, chamar `GET /options` pra montar os seletores de integração, entidade e tipo de busca.
1. Ao abrir a tela, chamar `GET /status`:
   - `run.status === "RUNNING"`: abrir bloqueado, mostrar o progresso e seguir consultando.
   - `othersRunning[id]` verdadeiro: mostrar o aviso.
2. Buscar: tratar `NOT_FOUND` (não achou) e `CHOOSE` (mostrar a lista, mesmo com 1 item). A busca nunca importa.
3. Na lista:
   - travar a seleção em `maxItems` (10);
   - desabilitar `importable: false`;
   - marcar `existsLocally` como "vai atualizar";
   - mostrar `alreadyProcessing`.
4. Confirmar (sempre necessário pra importar): mostrar o resultado por item. Se veio `run` (202), passar a acompanhar pelo `/status`.
5. Durante `RUNNING`, consultar `/status` a cada ~3s. Em `FINISHED`, mostrar o resumo por item (`result` / `error`) e liberar novo import.
6. Um 409 `USER_IMPORT_RUNNING` em qualquer POST significa "já tem import seu rodando": usar o `run` do erro pra mostrar o progresso.
