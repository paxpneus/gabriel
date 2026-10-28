# Mapeamento de produto pelo bipe — contrato com o front

Fluxos para quando o bipe não acha o produto ou acha o produto errado:

- **Auto busca de pneu**: sugere candidatos.
- **Mapear**: cria o DE x PARA do EAN bipado no produto escolhido.
- **Confirmar EAN físico**: o EAN bipado passa a ser só daquele produto na integração.
- **Registrar com foto**: continua existindo, mas só para quando os fluxos acima não resolvem.

Também entram aqui a troca do **mapeamento de integração principal**, o **relatório de pendências de integração** (admin) e o **histórico do produto**.

Todas as rotas exigem autenticação. Base: `/api`.

---

## Fluxo do bipe não encontrado

```
bipe não achou o produto
  └─ é pneu? → Auto busca (§1) com a medida (+ índice e marca, se o usuário souber)
       ├─ usuário escolhe um candidato → Mapear (§2)
       │    ├─ 201 → bipar de novo (agora resolve)
       │    ├─ EAN_OWNED_BY_ANOTHER_PRODUCT → mostrar os donos e oferecer "Confirmar EAN físico" (§3)
       │    ├─ EAN_HAS_PHYSICAL_OVERRIDE → mostrar quem confirmou e quando, e abrir o modal de foto (§4)
       │    └─ PRODUCT_NOT_MAPPED_IN_INTEGRATION → abrir o modal de foto (§4)
       └─ nenhum candidato serve → modal de foto (§4)
  └─ não é pneu → modal de foto (§4)
```

Quando o bipe acha o produto errado (o EAN está em outro produto), o caminho é o mesmo: Confirmar EAN físico (§3) no produto certo.

---

## Formato de erro (comum a §2, §3, §5 e §6)

Erro de regra: **400**.

```json
{
  "error": "Texto pronto para exibir ao usuário",
  "code": "EAN_OWNED_BY_ANOTHER_PRODUCT",
  "owners": [ /* só em EAN_OWNED_BY_ANOTHER_PRODUCT */ ],
  "override": { /* só em EAN_HAS_PHYSICAL_OVERRIDE */ },
  "can_confirm_physical_owner": false
}
```

`can_confirm_physical_owner`: o back já decidiu se o usuário logado pode "Confirmar EAN físico" (permissão no papel ou admin/developer). Só pode ser `true` em `EAN_OWNED_BY_ANOTHER_PRODUCT`; nos outros códigos é sempre `false`. O `error` já vem com a orientação certa ("use Confirmar EAN físico" ou "Tire uma foto para registrar o produto"). O front não confere permissão: exibe o `error` e segue o flag.

Erro sem `code` (validação simples, permissão etc.): `{ "error": "..." }`. Exibir o `error`.

| `code` | Quando | O que o front faz |
|---|---|---|
| `PRODUCT_NOT_MAPPED_IN_INTEGRATION` | O produto escolhido não tem mapeamento na integração | Abrir o modal de foto (§4) |
| `EAN_OWNED_BY_ANOTHER_PRODUCT` | O EAN (exato ou com outro zero à esquerda) já é de outro produto na integração | Listar `owners`. `can_confirm_physical_owner: true` → oferecer "Confirmar EAN físico" (§3); `false` → abrir o modal de foto (§4) |
| `EAN_HAS_PHYSICAL_OVERRIDE` | O EAN já foi confirmado como EAN físico de outro produto | Mostrar `override` (produto, quem, quando) e abrir o modal de foto (§4). Não oferecer "Confirmar EAN físico": ele não substitui outro EAN físico confirmado |

`owners[]`:
```json
{
  "product_id": "uuid",
  "product_name": "PNEU 12.5/80-18 R4 ...",
  "source": "PRODUCT_CONFIG",
  "code": "07891234567890",
  "unit_business_id": "uuid",
  "unit_business_name": "Loja 02"
}
```

- `source`: `PRODUCT_CONFIG` (EAN gravado nas configurações do produto em uma loja, que traz `unit_business_*`) ou `SUPPLIER_MAPPING` (EAN no DE x PARA).
- O mesmo produto pode aparecer mais de uma vez, uma por loja ou origem.

`override`:
```json
{
  "supplier_mapping_id": "uuid",
  "product_id": "uuid",
  "product_name": "PNEU ...",
  "code": "7891234567890",
  "user_id": "uuid | null",
  "user_name": "Fulano | null",
  "at": "2026-10-28T13:00:00.000Z | null"
}
```

---

## 1. Auto busca de pneu — `GET /api/products/tire-search/get`

Só leitura. Busca pneus cuja medida no nome é **exatamente** a informada. Índice de carga e marca não excluem nenhum candidato: só pontuam e ordenam.

### Query
| Parâmetro | Obrigatório | Exemplo | Observação |
|---|---|---|---|
| `mode` | sim | `IN_BATCH` / `NORMAL` | `IN_BATCH`: bipe dentro de lote de entrada ou expedição. `NORMAL`: inventário ou qualquer bipe fora de lote |
| `measure` | sim | `12.5/80-18`, `205/55R16` | Codificar na URL (`encodeURIComponent`) por causa da `/` |
| `load_index` | não | `R4`, `91` | |
| `brand` | não | `CAMSO` | |
| `expedition_batch_id` | só em `IN_BATCH` | uuid do lote | Ignorado em `NORMAL` |

- **`IN_BATCH`**: só retorna produtos do lote que **ainda faltam bipar**. Produto fora do lote ou já todo bipado não aparece. Se não falta nada, vem `[]`.
- **`NORMAL`**: catálogo todo.
- **Medida estrita**: `12.4/80-18` não aparece numa busca por `12.5/80-18`. Espaço em volta de `/`, `-` e `R` é tolerado (`205/55 R16` casa com `205/55R16`). Sufixo colado (`205/70R15LT`) também casa.

### Respostas
- `200`: array, já ordenado (ver abaixo).
- `400`: `mode` ausente ou inválido, `measure` ausente, ou `IN_BATCH` sem `expedition_batch_id`.
- `404`: lote não encontrado na loja do usuário.

```json
[
  {
    "product": {
      "id": "uuid",
      "name": "PNEU 12.5/80-18 R4 12PR SL TL PNEU CAMSO",
      "brand_id": "uuid | null",
      "brand": "CAMSO | null",
      "line": "string | null",
      "brandRegister": { "id": "uuid", "name": "CAMSO" },
      "productConfigs": [{ "id": "uuid", "sku": "123", "gtin": "789...", "unit_business_id": "uuid" }],
      "stocks": [{ "id": "uuid", "quantity": 4, "unit_business_id": "uuid" }]
    },
    "matches": { "load_index": true, "brand": true },
    "score": { "matched": 2, "total": 2 },
    "probability": "ALTA",
    "mapped_in_user_integration": true
  }
]
```

- **`productConfigs` e `stocks`**: só da loja do usuário. Vêm vazios se o produto não tem configuração ou estoque nela.
- **`matches.load_index` / `matches.brand`**: `true` ou `false` se o parâmetro foi enviado; `null` se não foi.
- **`score.total`**: quantos opcionais foram enviados (0 a 2). **`score.matched`**: quantos bateram.
- **`probability`**:
  - `ALTA`: todos os opcionais bateram;
  - `MEDIA`: parte bateu (só existe com os dois opcionais enviados);
  - `IMPROVAVEL`: nenhum bateu;
  - `null`: só a medida foi enviada (todos ficam iguais).
- **Ordem**: `ALTA`, `MEDIA`, `IMPROVAVEL`. Dentro de `MEDIA`, quem bateu o índice vem antes de quem bateu só a marca. Depois, por nome.
- **`mapped_in_user_integration: false`**: o produto existe, mas não está vinculado à integração do usuário. Mostrar o aviso "não vinculado à integração" no card.
  - Bipagem (§2/§3): mapear vai dar `PRODUCT_NOT_MAPPED_IN_INTEGRATION`; no clique, ir direto para o modal de foto.
  - Tela de não mapeados (§5): **não bloquear** a escolha. Quem decide se dá para vincular é o back (§5).
- O índice é procurado como termo separado: `R4` não casa com `R44` nem com `R-4`.

---

## 2. Mapear o EAN bipado no produto escolhido — `POST /api/supplier-mapping/product/:productId`

Cria o DE x PARA (EAN bipado → produto) na integração do usuário logado.

### Body
```json
{ "supplier_product_code": "7891234567890", "supplier_cnpj": "opcional" }
```

### Respostas
- `201`: o DE x PARA criado (`{ id, product_id, supplier_product_code, supplier_cnpj, integrations_id, is_physical_override: false, ... }`). O registro com foto (`ERROR_SCAN`) desse EAN, se existir, é apagado automaticamente.
- `400` com `code`: ver a tabela de erros. Os três `code` são possíveis aqui.

---

## 3. Confirmar EAN físico — `POST /api/supplier-mapping/product/:productId/physical-owner`

O EAN bipado passa a ser **só** deste produto na integração:
- é apagado das configurações e do DE x PARA de qualquer outro produto da integração (inclusive com outro zero à esquerda);
- o sync com o ERP para de gravá-lo nos outros;
- o ERP não é alterado.

Fica registrado quem fez e quando.

**Permissão própria:** "Confirmar EAN físico", concedida no cadastro de papéis. Sem ela: `400` `{ "error": "Acesso negado: sem permissão de ... em \"Confirmar EAN físico\"." }`. Admin e developer (`user.type` `admin` ou `developer`) sempre podem, mesmo sem a permissão no papel. Mostrar o botão só quando o erro veio com `can_confirm_physical_owner: true`.

### Body
```json
{ "supplier_product_code": "7891234567890", "integrations_id": "opcional" }
```

- **Coletor**: não mandar `integrations_id`; vale a integração da loja do usuário.
- **Desktop**: mandar o `integrations_id` da integração escolhida pelo usuário.

### Respostas
- `201`:
```json
{
  "supplierMapping": { "id": "uuid", "product_id": "uuid", "supplier_product_code": "7891234567890", "integrations_id": "uuid", "is_physical_override": true },
  "cleared": [ /* mesmo formato de owners[]: de quem o EAN foi retirado; vazio se ninguém tinha */ ]
}
```
  Também apaga os registros com foto (`ERROR_SCAN`) desse EAN na integração. Sugestão: mostrar o `cleared` na confirmação ("EAN retirado de: ...").
- `400` com `code`:
  - `PRODUCT_NOT_MAPPED_IN_INTEGRATION` → modal de foto;
  - `EAN_HAS_PHYSICAL_OVERRIDE` → mostrar `override` e abrir o modal de foto. **Nada foi alterado.**
- `400` sem `code`: `"Informe o EAN bipado"`, `"Integração não encontrada"`.

Sugestão: pedir confirmação antes de chamar, porque a ação retira o EAN de outros produtos. Usar o `owners` do erro de §2 para mostrar quem vai perder o EAN.

---

## 4. Registrar com foto — `POST /api/unmapped-invoice-product/from-ean/create` (já existente, sem mudança de contrato)

`multipart/form-data` com `ean` e a imagem. Agora é usado só quando:
- o produto não existe;
- o produto não está vinculado à integração (`PRODUCT_NOT_MAPPED_IN_INTEGRATION`);
- o EAN já é EAN físico confirmado de outro produto (`EAN_HAS_PHYSICAL_OVERRIDE`);
- nenhum candidato da auto busca serve.

---

## 5. Mapear a partir de um não mapeado — `POST /api/supplier-mapping/from-unmapped` (tela de não mapeados)

### Body
```json
{ "product_id": "uuid", "unmapped_invoice_product_id": "uuid", "supplier_cnpj": "opcional" }
```

### Produto já vinculado à integração do não mapeado
- Cria o DE x PARA com o EAN (ou SKU) do não mapeado, **sempre** como EAN físico confirmado (`is_physical_override: true`). Se o produto já tinha DE x PARA com esse código, ele passa a ser confirmado.
- Antes de criar, valida o EAN como em §2. Pode voltar `400` com `EAN_OWNED_BY_ANOTHER_PRODUCT` ou `EAN_HAS_PHYSICAL_OVERRIDE` (mesmo formato).
- Se o não mapeado tem código do ERP, vincula esse código ao produto também (ver "principal" abaixo).

### Produto ainda não vinculado à integração do não mapeado
Só é permitido quando o não mapeado é um produto do ERP sem cadastro **e** tem o código do ERP:
- "Produto novo, precisa de mapeamento manual"; ou
- "Produto Tecinco presente na nota mas sem produto correspondente no banco".

Nesse caso o back vincula o produto ao código do ERP, tenta criar o DE x PARA do EAN (se o EAN já for de outro produto, só não cria, **sem erro**) e resolve o não mapeado. Se for de nota, o item entra na nota.

Qualquer outro caso → `400` `{ "error": "<mensagem pronta>", "code": "PRODUCT_NOT_MAPPED_IN_INTEGRATION" }`. Exibir só o `error`; a mensagem já explica o motivo.

### Principal
- Primeiro código do produto naquela integração → nasce principal (`is_primary: true`).
- Já tem principal → o novo nasce `is_primary: false`. O back **nunca troca o principal sozinho**: o usuário troca por `PUT /api/integration-mapping/product/:productId/:id` `{ "is_primary": true }` (§7).

### Respostas
- `201`:
  ```json
  {
    "supplierMapping": { "...": "DE x PARA" } ,
    "integrationMapping": { "id": "uuid", "external_id": "90001", "is_primary": true },
    "integration": { "id": "uuid", "name": "Tecinco" },
    "integrationMappings": [
      { "id": "uuid", "external_id": "90001", "is_primary": true, "erp_data": { "name": "string | null", "ean": "string | null" } }
    ]
  }
  ```
  - `supplierMapping`: `null` se não criou (EAN de outro produto no vínculo novo, ou não mapeado `ERROR_CATALOG_DUPLICATE`).
  - `integrationMapping`: `null` se não vinculou código do ERP (não mapeado sem código do ERP).
  - `integrationMappings`: todos os códigos do produto **naquela integração**, depois do vínculo. `erp_data` é `null` enquanto o sync não passou pelo código. **`integrationMappings.length > 1`** → mostrar o aviso de que o produto tem mais de um código no ERP (e qual é o principal).
- `400`: `PRODUCT_NOT_MAPPED_IN_INTEGRATION` (acima), erros de EAN de §2 (produto já vinculado), ou código do ERP já vinculado a outro produto (mensagem pronta).
- `404`: não mapeado de outra integração ou inexistente.

### Criar Produto na nota — `POST /api/unmapped-invoice-product/:id/create-product-and-map`
Segue funcionando. Exige não mapeado de nota com código do ERP; responde `202` e o andamento é pelo `GET /api/unmapped-invoice-product/:id/create-product/job`.

**Permissão** — "Criar Produto" e mapear produto na nota (`POST /api/invoice-items/add/item`) só para admin/developer ou papel com a permissão personalizada **"Criar e mapear produto na nota"** (entidade `invoice_product_mapping`, ação `write`, concedida na edição de papéis). Sem ela: `400` `{ "error": "Acesso negado: sem permissão de \"Criar\" em \"Criar e mapear produto na nota\"." }`. Sugestão: esconder os botões para quem não tem (admin/developer ou `role.permissions` com essa entidade).

---

## 6. Listar, editar e remover DE x PARA do produto

- **`GET /api/supplier-mapping/product/:productId`** (paginado): cada linha traz `is_physical_override`. Sugestão: selo "EAN físico confirmado".
- **`PUT /api/supplier-mapping/product/:productId/:id`**, body `{ supplier_product_code?, supplier_cnpj?, is_physical_override? }`:
  - linha com `is_physical_override: true`: só admin/developer, senão `400` `"Somente administradores podem alterar ou remover um EAN físico confirmado"`;
  - **desativar o EAN físico confirmado**: `{ "is_physical_override": false }`. A linha continua como DE x PARA comum do mesmo produto e fica registrado quem fez. A partir daí ela volta a seguir as regras normais: se o ERP de outro produto manda esse EAN, o próximo sync pode tirar o DE x PARA daqui e gravar o EAN lá;
  - `{ "is_physical_override": true }` → `400` `"Para confirmar o EAN físico use a opção \"Confirmar EAN físico\""` (confirmar só por §3);
  - trocar o código passa pela mesma validação de §2 (`400` com `code`);
  - `404`: não é desse produto.
- **`DELETE /api/supplier-mapping/product/:productId/:id`** → `204`:
  - linha confirmada: só admin/developer (mesmo `400`);
  - depois de remover, o próximo sync devolve o EAN do ERP aos outros produtos.
- Rotas genéricas e em massa (`/api/supplier-mapping`, `/bulk`):
  - `is_physical_override` no body é ignorado;
  - em massa, as linhas confirmadas ficam de fora para quem não é admin/developer.

Sugestão: esconder editar/remover/desativar nas linhas confirmadas para quem não é admin/developer (`user.type` `admin` ou `developer`). Para admin, botão "Desativar EAN físico" na linha confirmada.

---

## 7. Mapeamento de integração principal

Um produto pode ter mais de um código no mesmo ERP. **Só o principal grava dados no sistema**: preço, estoque, EAN e SKU. Os outros só guardam o que o ERP diz deles, para consulta.

- **`GET /api/integration-mapping/product/:productId`** (paginado), cada linha com:
  - `is_primary: boolean`;
  - `integration: { id, name }`;
  - `erp_data`: o que o ERP diz daquele código, só leitura:
    ```json
    {
      "name": "string | null",
      "ean": "string | null",
      "sku": "string | null",
      "ean_package": "string | null (Bling)",
      "stock": "number | null (Bling)",
      "stocks": [{ "branch_id": 1, "unit_business_id": "uuid | null", "unit_business_name": "Loja 01 | null", "quantity": 3 }],
      "updated_at": "ISO"
    }
    ```
    `stocks` só vem da Tecinco, um por filial. `unit_business_name` só vem nos códigos sincronizados depois desta versão; antes disso, cair para o `branch_id`. `erp_data` fica `null` até o primeiro sync daquele código.
- **Trocar o principal**: `PUT /api/integration-mapping/product/:productId/:id` com `{ "is_primary": true }`. Desmarca os outros do mesmo produto na mesma integração.
  - `{ "is_primary": false }` → `400` `"Para trocar o principal, marque outro mapping como principal"`.
  - `404`: não é desse produto.
- **Remover o principal**: o próximo mais antigo vira principal automaticamente.

Sugestão: selo "Principal" e botão "Tornar principal" nas outras linhas, mostrando `erp_data` (nome, EAN, estoque) para o usuário comparar.

---

## 8. Relatório de pendências de integração — `GET /api/supplier-mapping/integration-pending/get?section=`

Só admin/developer (os outros recebem `403`). Usa a integração do usuário logado. **Sem paginação**: o array vem completo. Só leitura.

`section`: `overrides` | `erp_duplicates` | `missing_ean` | `unmapped`. Ausente ou inválido vale `overrides`.

Formato comum de produto que o ERP diz ter o EAN (`ErpProduct`):
```json
{
  "product_id": "uuid",
  "product_name": "string | null",
  "eans": ["07891234567890"],
  "sources": ["ERP_PRIMARY", "ERP_NON_PRIMARY"],
  "unit_businesses": ["Loja 02"]
}
```

- `ERP_PRIMARY`: veio do código principal do ERP, por loja.
- `ERP_NON_PRIMARY`: veio de um código não principal. Não tem loja.

### `overrides`: EAN físico confirmado que o ERP ainda manda para outros produtos
```json
[{
  "ean": "7891234567890",
  "owner": { "product_id": "uuid", "product_name": "string | null" },
  "defined_by": { "user_id": "uuid | null", "user_name": "string | null", "date": "ISO" },
  "replaced": [ /* ErpProduct[] */ ]
}]
```
`defined_by` pode ser `null` em registros antigos. Ação sugerida: corrigir o EAN no ERP dos produtos em `replaced`.

### `erp_duplicates`: mesmo EAN em 2 ou mais produtos no ERP
```json
[{
  "ean": "7891234567890",
  "products": [ /* ErpProduct[] */ ],
  "prevailing": {
    "rule": "PHYSICAL_OVERRIDE | LOCAL_GTIN | SUPPLIER_MAPPING | NONE",
    "products": [{ "product_id": "uuid", "product_name": "string | null" }]
  }
}]
```

- `ean` é o código **sem zeros à esquerda**, porque agrupa as variações. Os valores originais estão em `products[].eans`.
- `prevailing` diz quem usa o EAN hoje no sistema. Sugestão de rótulos:

| `rule` | Rótulo |
|---|---|
| `PHYSICAL_OVERRIDE` | EAN físico confirmado |
| `LOCAL_GTIN` | EAN nas configurações do produto |
| `SUPPLIER_MAPPING` | Mapeamento DE x PARA |
| `NONE` | Nenhum (EAN ignorado em todos) |

### `missing_ean`: produto sem EAN no ERP
```json
[{ "product_id": "uuid", "product_name": "string | null", "unit_businesses": ["Loja 02", "Loja 05"] }]
```

### `unmapped`: produtos não mapeados pendentes
```json
[{
  "id": "uuid",
  "type": "ERROR_SCAN | ERROR_CATALOG | ...",
  "ean": "string | null",
  "sku": "string | null",
  "product_name": "string | null",
  "external_id": "string | null",
  "reason": "string",
  "quantity": 1,
  "invoice_id": "uuid | null",
  "image_path": "string | null",
  "createdAt": "ISO",
  "invoice": { "id": "uuid", "number_system": "123" }
}]
```
Mais recentes primeiro.

A seção `missing_ean`, e o que `overrides` e `erp_duplicates` leem do ERP, só ficam completos depois de um sync completo de produtos (Tecinco: run completo; Bling: populate de produtos).

---

## 9. Histórico do produto — `GET /api/products/:id/audit-logs`

Paginado, mais recente primeiro. Query: `page`, `perPage` (padrão 20), `filters[action]=CREATE|UPDATE|DELETE`.

Entra no histórico:
- Confirmar EAN físico;
- mapear pela busca (§2);
- mapear a partir de não mapeado (§5);
- desativar ou remover EAN físico confirmado;
- trocar o mapeamento principal (§7).

O sync automático não entra.

```json
{
  "data": [{
    "id": "uuid",
    "date": "ISO",
    "action": "UPDATE",
    "entity": "PRODUCT",
    "internal_id": "uuid do produto",
    "description": "Texto pronto para exibir ao usuário",
    "user": { "id": "uuid", "name": "Fulano" },
    "user_id": "uuid | null",
    "changes": {
      "summary": "Resumo da operação",
      "before": {},
      "after": {},
      "affected": [{
        "entity": "SUPPLIER_MAPPING | PRODUCT_CONFIG | INTEGRATION_MAPPING | PRODUCT",
        "internal_id": "uuid",
        "action": "CREATE | UPDATE | DELETE",
        "label": "opcional",
        "before": {},
        "after": {}
      }]
    }
  }],
  "meta": { "total": 12, "page": 1, "perPage": 20, "totalPages": 1, "hasNext": false, "hasPrev": false }
}
```

- Exibir `description`, `user.name` (ou "usuário não identificado" quando `user` é `null`) e `date`.
- `changes` é o detalhe técnico (o que mudou em cada registro afetado), para uma tela de detalhe. `before`, `after` e `affected` podem não vir.

---

## 10. Bipe com EAN ambíguo

Quando o código bipado (considerando zeros à esquerda) corresponde a **mais de um produto** na integração, o bipe é recusado com `400` e `error`. O front só exibe a mensagem:
- **Inventário:** `"Código X corresponde a mais de um produto (considerando zeros à esquerda) — não é possível bipar"`.
- **Expedição/entrada** (`/api/scan-logs/scan/product...`) **e `GET /api/products/by-code/:code`:** `"... — não é possível identificar o produto"`.

Como resolver: "Confirmar EAN físico" (§3) no produto certo.
