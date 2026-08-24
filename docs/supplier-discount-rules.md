# Desconto de Fornecedor — guia de integração (front)

Módulo de regras de repasse/desconto de fornecedor por marca/aro/medida/loja. Não é desconto de venda: não aparece pro cliente, não mexe no valor de venda exibido — só entra como redutor de custo no `contribution_value` dos relatórios (`sales-report` e `seller-sales-report`), calculado em background quando os pedidos são reprocessados. O front só faz CRUD da regra; o cálculo em si é 100% backend.

## Como o módulo funciona (resumo pro front)

- Uma **regra** (`supplier_discount_rule`) tem: quantidade mínima/bloco (`quantity_step`), tipo (`REAL` ou `PERCENTUAL`), valor do desconto, período de vigência (`start_date`/`end_date`, com hora), e um **escopo**: conjuntos de marca, aro, medida e loja.
- **Marca, aro e medida são curinga quando vazios** — se a regra não tiver nenhuma marca cadastrada, ela vale pra qualquer marca (e assim por diante pra aro/medida). **Loja nunca é curinga**: toda regra precisa ter pelo menos 1 loja no escopo.
- **Fórmula REAL** (bloco fixo): a cada `quantity_step` unidades vendidas dentro do escopo, soma `discount_value` ao lucro. Ex.: "a cada 2 pneus, +R$200" — 4 pneus vendidos = +R$400.
- **Fórmula PERCENTUAL**: aplica `discount_value`% sobre o valor bruto vendido, só se a quantidade total vendida no escopo atingir `quantity_step` (limiar, não multiplicador).
- **Regras REAL podem se sobrepor entre si de propósito**, pra formar níveis por quantidade (ex.: regra A "a cada 2, R$200" + regra B "a cada 4, R$500" no mesmo escopo — o backend escolhe a melhor combinação de blocos sozinho). **PERCENTUAL nunca pode se sobrepor com nenhuma outra regra** (nem REAL nem PERCENTUAL) no mesmo escopo+período — o backend **rejeita a criação/edição** nesse caso (ver seção de erros).
- O valor calculado só aparece nos relatórios depois que o pedido é (re)processado — não há recálculo em tempo real na tela de detalhe do pedido.

## Rotas

Base: `/api/supplier-discount-rules`

Autenticação: igual ao resto da API — cookie `token` ou header `Authorization: Bearer <jwt>`. Permissão exigida no papel do usuário: entidade **`supplier_discount_rules`**, ações `read`/`write`/`update`/`delete` (GET/POST/PUT-PATCH/DELETE respectivamente).

| Método | Rota | Ação |
|---|---|---|
| GET | `/api/supplier-discount-rules` | Lista paginada, escopo já incluso (ver "GET — resposta") |
| GET | `/api/supplier-discount-rules/:id` | Detalhe de uma regra, escopo já incluso |
| POST | `/api/supplier-discount-rules` | Cria regra + escopo |
| PUT | `/api/supplier-discount-rules/:id` | Atualiza regra + escopo (substitui o escopo inteiro, não faz merge parcial) |
| DELETE | `/api/supplier-discount-rules/:id` | Remove a regra (cascade nos pivôs de escopo) |
| DELETE | `/api/supplier-discount-rules/bulk` | Remove várias (`{ "ids": ["uuid", ...] }`) |

**⚠️ Não use `POST /bulk` nem `PUT /bulk` pra esse recurso.** Essas duas rotas existem porque são herdadas do CRUD genérico do backend, mas elas **não passam pela validação de sobreposição nem sincronizam o escopo** (marca/aro/medida/loja) — criariam/editariam regras "soltas", sem loja nenhuma vinculada, o que quebra o motor de matching. Só `POST /` e `PUT /:id` (um de cada vez) fazem o fluxo completo. `DELETE /bulk` é seguro (delete não precisa de validação de escopo).

### Listagem — query params

Mesmo padrão de paginação/filtro usado no resto da API:

| Param | Tipo | Obs |
|---|---|---|
| `page` | number | default 1 |
| `perPage` | number | default 20 |
| `sortBy` | string | `start_date`, `end_date`, `discount_value`, `createdAt` |
| `sortDir` | `ASC`\|`DESC` | default `DESC` |
| `filters[discount_type]` | `REAL`\|`PERCENTUAL` | |
| `filters[active]` | `true`\|`false` | |

Não tem busca por texto (`search`) — a regra não tem nome/label, só os campos estruturados.

## Types (TypeScript pro front registrar)

```ts
type SupplierDiscountType = "REAL" | "PERCENTUAL";

// Body de POST / e PUT /:id — os 4 campos de escopo são arrays de id
// (UUID) das entidades já cadastradas em outros módulos:
//   brand_ids          -> GET /api/brands
//   rim_ids             -> GET /api/rims
//   measure_ids          -> GET /api/tire-measures
//   unit_business_ids   -> GET /api/unit-business
// Array vazio ou ausente = curinga (não restringe o eixo) — EXCETO
// unit_business_ids, que é obrigatório ter pelo menos 1 item.
interface SupplierDiscountRuleInput {
  quantity_step: number;          // obrigatório, inteiro > 0
  discount_type: SupplierDiscountType; // obrigatório
  discount_value: number;         // obrigatório — R$ se REAL, % se PERCENTUAL (ex.: 10 = 10%)
  start_date: string;             // obrigatório — ISO datetime, ex. "2026-01-01T00:00:00.000Z"
  end_date: string;               // obrigatório — ISO datetime
  active?: boolean;                // default true
  brand_ids?: string[];            // vazio = qualquer marca
  rim_ids?: string[];              // vazio = qualquer aro
  measure_ids?: string[];          // vazio = qualquer medida
  unit_business_ids: string[];     // OBRIGATÓRIO, não pode ser vazio
}

// Resposta de GET /:id e de cada item de GET / — MESMO formato do
// SupplierDiscountRuleInput (dá pra fazer fetch e reenviar o objeto direto
// num PUT, só trocando os campos editados).
interface SupplierDiscountRuleDetail {
  id: string;
  quantity_step: number;
  discount_type: SupplierDiscountType;
  discount_value: number;         // vem como string decimal do Postgres (ex. "200.00") — fazer Number() antes de usar em conta
  start_date: string;              // ISO datetime
  end_date: string;                // ISO datetime
  active: boolean;
  brand_ids: string[];
  rim_ids: string[];
  measure_ids: string[];
  unit_business_ids: string[];
  createdAt: string;
  updatedAt: string;
}

// Resposta de GET / (lista)
interface PaginatedResult<T> {
  data: T[];
  meta: {
    total: number;
    page: number;
    perPage: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}
```

> `discount_value` volta como **string** no JSON (tipo `DECIMAL` do Postgres serializado pelo Sequelize) — sempre `Number(discount_value)` antes de somar/formatar. Todo `*_id`/`*_ids` é UUID.

## Exemplos de payload

**Criar uma regra REAL** (a cada 2 pneus aro 14 ou 15, em 2 lojas, +R$200):
```json
POST /api/supplier-discount-rules
{
  "quantity_step": 2,
  "discount_type": "REAL",
  "discount_value": 200,
  "start_date": "2026-01-01T00:00:00.000Z",
  "end_date": "2026-12-31T23:59:59.000Z",
  "rim_ids": ["<uuid-aro-14>", "<uuid-aro-15>"],
  "unit_business_ids": ["<uuid-loja-1>", "<uuid-loja-2>"]
}
```
(`brand_ids`/`measure_ids` omitidos = curinga, vale pra qualquer marca/medida.)

**Criar um segundo nível pra mesma faixa** (a cada 4, +R$500 — coexiste com a regra acima, o backend escolhe a melhor combinação):
```json
POST /api/supplier-discount-rules
{
  "quantity_step": 4,
  "discount_type": "REAL",
  "discount_value": 500,
  "start_date": "2026-01-01T00:00:00.000Z",
  "end_date": "2026-12-31T23:59:59.000Z",
  "rim_ids": ["<uuid-aro-14>", "<uuid-aro-15>"],
  "unit_business_ids": ["<uuid-loja-1>", "<uuid-loja-2>"]
}
```

**Criar uma regra PERCENTUAL** (10% se vender 10+ unidades no escopo):
```json
POST /api/supplier-discount-rules
{
  "quantity_step": 10,
  "discount_type": "PERCENTUAL",
  "discount_value": 10,
  "start_date": "2026-01-01T00:00:00.000Z",
  "end_date": "2026-12-31T23:59:59.000Z",
  "brand_ids": ["<uuid-marca>"],
  "unit_business_ids": ["<uuid-loja-1>"]
}
```

**Editar uma regra** — mesmo shape do create, sempre manda o escopo INTEIRO (o PUT substitui, não faz merge):
```json
PUT /api/supplier-discount-rules/<id>
{
  "quantity_step": 2,
  "discount_type": "REAL",
  "discount_value": 250,
  "start_date": "2026-01-01T00:00:00.000Z",
  "end_date": "2026-12-31T23:59:59.000Z",
  "rim_ids": ["<uuid-aro-14>"],
  "unit_business_ids": ["<uuid-loja-1>", "<uuid-loja-2>"]
}
```
(Se o front busca via `GET /:id` pra preencher o form de edição, e reenvia o objeto sem tocar em `id`/`createdAt`/`updatedAt` — que o backend ignora no body — o PUT funciona direto.)

## Erros esperados

Todos os erros de validação vêm com **400** e `{ "error": "<mensagem>" }`:

| Situação | Mensagem |
|---|---|
| `unit_business_ids` vazio ou ausente | `Erro: Ids das unidades de negócio não pode ser vazio — loja não é um eixo curinga.` |
| Falta `quantity_step`/`discount_type`/`discount_value`/`start_date`/`end_date` | `Erro: Quantidade de Pneus, Tipo do Desconto, Valor do Desconto, Data de Início e Data Final são obrigatórios.` |
| Sobreposição bloqueada (PERCENTUAL cruzando escopo+período com qualquer outra regra ativa) | `Já existe uma regra ativa com escopo e período sobrepostos envolvendo desconto PERCENTUAL nesse conjunto de marca/aro/medida/loja.` |

`GET /:id` com id inexistente → **404** `{ "error": "Não encontrado" }`. `PUT /:id` com id inexistente → **400** `{ "error": "supplier_discount_rules: regra id=<id> não encontrada" }` (não é 404 — segue o mesmo formato de erro de validação). Falta de permissão → **400** `{ "error": "Acesso negado: sem permissão de \"<ação>\" em \"<escopo>\"." }`. Sem token → **401**.

## Onde buscar as listas pros seletores de escopo

Essas rotas já existem e são independentes deste módulo — usar pra popular os multi-select de marca/aro/medida/loja no form:

- `GET /api/brands` → `{id, name, ...}`
- `GET /api/rims` → `{id, value, ...}` (ex.: `"14"`, `"15"`)
- `GET /api/tire-measures` → `{id, value, ...}` (ex.: `"175/70/13"`)
- `GET /api/unit-business` → `{id, name, ...}`

Todas seguem o mesmo padrão de paginação (`page`/`perPage`) e autenticação do resto da API.
