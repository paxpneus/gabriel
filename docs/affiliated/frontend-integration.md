# Afiliados e cupons: contrato com o front

Afiliado é um contato (`type: "AFFILIATED"`) com login próprio. Ele ganha comissão nos pedidos do site (Magento) feitos com um cupom vinculado a ele. Esta entrega traz:

1. **Cadastro de afiliado** (contato + usuário de uma vez): `POST /api/contacts/with-user`
2. **Login do afiliado**: `POST /api/contacts/affiliated/login` e `GET /api/contacts/affiliated/me`
3. **Cupons**: `/api/coupons`
4. **Vínculo afiliado ↔ cupom**: `/api/contact-coupons`
5. **Comissão do afiliado nos relatórios** (campos e filtro novos)
6. **Relatório do afiliado** (o afiliado logado vê as próprias vendas): `GET /api/affiliated-report`

Todas as rotas, exceto o login do afiliado, exigem autenticação. Erros vêm como `{ "error": "mensagem" }` (status `400`, ou `404` quando o registro não existe). As mensagens já estão em português e podem ser exibidas como estão.

---

## Permissões

Duas permissões novas aparecem na tela de papéis:

| Permissão | Libera |
|---|---|
| **Contatos** | listar, ver e editar contatos, e cadastrar afiliado/vendedor com usuário (`/with-user`) |
| **Cupons** › **Cupons de Afiliado** | cupons (`/api/coupons`) e vínculos com afiliado (`/api/contact-coupons`). O filho herda do pai: quem tem "Cupons" acessa os dois. |

Admin e developer têm acesso total, como sempre.

**Como o front esconde as telas.** As permissões vêm do papel, não do `allowedModules`: o `allowedModules` é o menu do tipo de usuário e não tem estas chaves. Use `role.permissions` do `GET /api/users/me/get`, procurando a entrada pelo `entity`:

| Tela / ação | Entrada | Ação necessária |
|---|---|---|
| Aba de cupons do afiliado (e lista de cupons) | `coupons` | `read` |
| Vincular / transferir cupom; criar cupom | `coupons` | `write` |
| Editar taxa, ativar/inativar vínculo ou cupom | `coupons` | `update` |
| Cadastro de afiliado (`/with-user`) | `contacts` | `write` |

"Cupons de Afiliado" (`contact_coupons`) não tem entrada própria: herda de `coupons`. Usuário com `type` `admin` ou `developer` tem acesso a tudo, mesmo sem a entrada no papel.

---

## 1. Cadastro: `POST /api/contacts/with-user`

Cria o usuário e o contato numa transação só: ou os dois são criados, ou nenhum.

**Body**

| Campo | Tipo | Obrigatório | Observação |
|---|---|---|---|
| `type` | `"AFFILIATED"` \| `"SELLER"` | sim | Os outros tipos (`CUSTOMER`, `SELLER_MANAGER`) são recusados. |
| `name` | string | sim | 3 a 255 caracteres. |
| `cpf` | string | sim | Com ou sem máscara; validado. Vira o documento do contato. |
| `email` | string | sim | É o login. |
| `password` | string | sim | Mínimo 8 caracteres. |
| `phone` | string \| null | não | Até 20 caracteres. |
| `unit_business_id` | uuid | só para `SELLER` | No afiliado é **ignorado**: a loja é sempre a 21 (CD21). |

Não há `custom_data` nem `id_system` nesse cadastro.

**Resposta `201`**

```json
{
  "contact": { "id": "uuid", "name": "Fulano", "type": "AFFILIATED", "document": "12345678909", "unit_business_id": "uuid", "user_id": "uuid", "id_system": null },
  "user": { "id": "uuid", "name": "Fulano", "email": "fulano@x.com", "cpf": "12345678909", "phone": null, "unit_business_id": "uuid", "type": "affiliated" }
}
```

A senha nunca volta na resposta.

**Erros comuns (`400`)**: e-mail ou CPF já usado por outro usuário; "Já existe um contato com este CPF"; "Loja (unit_business_id) é obrigatória para este tipo de contato" (vendedor sem loja); `Tipo de contato "CUSTOMER" não permite criar usuário`.

**Listar afiliados**: use a listagem de contatos que já existe, `GET /api/contacts?filters[type]=AFFILIATED`. Serve para o select de afiliado no vínculo de cupom e no filtro dos relatórios.

**Mudanças que afetam telas atuais**

- `id_system` do contato agora pode vir `null`: contato criado por aqui não existe no Bling. Telas que exibem esse campo precisam tratar o vazio.
- O usuário ganhou `phone` (opcional, até 20 caracteres) no cadastro e na edição normais de usuário.

---

## 2. Login do afiliado

O afiliado **não** entra pelo login do hub. `POST /api/users/login` recusa com `"Afiliados devem acessar pelo login de afiliado"`. Ele também não tem nenhum módulo do hub (tipo `affiliated`, sem menu).

**`POST /api/contacts/affiliated/login`**, sem autenticação

- Body: `{ "email": "...", "password": "..." }`.
- Grava o mesmo cookie `token` do login do hub (httpOnly, 8h).
- Resposta `200`:

```json
{ "user": { "name": "Fulano", "unit_business": { "number": "21", "name": "CD21" } } }
```

Usuário que não é afiliado recebe `400` com `"Usuário sem acesso a este login"`.

**`GET /api/contacts/affiliated/me`**, com o cookie

- Retorna o mesmo `{ "user": { ... } }` do login.
- `400` se a sessão não for de afiliado.

**Logout**: `POST /api/users/logout`, a mesma rota do hub. Não exige autenticação nem body e apaga o cookie `token`. O cookie é httpOnly, então só essa chamada encerra a sessão antes das 8h.

---

## 3. Cupons: `/api/coupons`

Cupom **nunca é apagado**, para preservar o histórico dos pedidos; ele é só ativado ou inativado. As rotas `DELETE` e as de bulk respondem `405`.

| Rota | O que faz |
|---|---|
| `GET /api/coupons` | Lista paginada (padrão de sempre: `page`, `perPage`, `search` pelo código, `filters[active]=true`). Ordena do mais novo para o mais antigo. |
| `GET /api/coupons/:id` | Detalhe. |
| `POST /api/coupons` | Cria. Body: `{ code, discount_type?, discount_value?, active? }`. |
| `PUT /api/coupons/:id` | Edita os mesmos campos, todos opcionais. |
| `PATCH /api/coupons/:id/activate` | Ativa. |
| `PATCH /api/coupons/:id/deactivate` | Inativa. |

- `code`: até 50 caracteres. É gravado em **maiúsculas e sem espaços nas pontas** (`" promo10 "` vira `"PROMO10"`). Se o código repetir: `"Já existe um cupom com este código"`.
- `discount_type` (`"percent"` ou `"fixed"`) e `discount_value` são **só informativos**: a comissão do afiliado não depende deles.
- Cupom usado num pedido do site que ainda não existe no cadastro é criado sozinho, ativo e sem desconto definido. Por isso podem aparecer na lista cupons que ninguém cadastrou.
- Cupom **inativo** não gera comissão: o pedido grava só o desconto.

---

## 4. Vínculo afiliado ↔ cupom: `/api/contact-coupons`

Cada cupom tem **no máximo um dono ativo** por vez. Um afiliado pode ter vários cupons. O vínculo também nunca é apagado (`DELETE`/bulk respondem `405`): quando inativado, ele fica no histórico com `deactivated_at`.

| Rota | Body | O que faz |
|---|---|---|
| `GET /api/contact-coupons` | — | Lista paginada. Filtros: `filters[contact_id]`, `filters[coupon_id]`, `filters[active]`. |
| `GET /api/contact-coupons/:id` | — | Detalhe. |
| `POST /api/contact-coupons` | `{ contact_id, coupon_id, commission_rate }` | Vincula. Retorna `201`. |
| `POST /api/contact-coupons/transfer` | `{ contact_id, coupon_id, commission_rate }` | Troca o dono: inativa o vínculo atual do cupom e cria o do novo afiliado, numa transação só. Retorna `201`. |
| `PUT /api/contact-coupons/:id` | `{ commission_rate }` | Muda **só** a taxa. Outro campo no body é recusado. |
| `PATCH /api/contact-coupons/:id/deactivate` | — | Inativa o vínculo. |

**Registro retornado** (na lista, no detalhe e na resposta de todas as escritas): `{ id, contact_id, coupon_id, commission_rate, active, deactivated_at, createdAt, updatedAt, coupon: { id, code, active } }`. O `coupon.active` é o status do cupom, para o botão de ativar/inativar (`/api/coupons/:coupon_id/activate|deactivate`); `active` na raiz é o status do vínculo. O nome do afiliado não vem, porque a aba já filtra por `contact_id`.

**Regras e mensagens (`400`)**

- `commission_rate` é percentual de 0 a 100 (`5` = 5%).
- O `contact_id` precisa ser um afiliado: `"Somente contatos do tipo afiliado podem ter cupom vinculado"`.
- Se o cupom já tem dono ativo, o `POST /` recusa com `"Este cupom já tem um afiliado ativo. Use a transferência para trocar o dono."`. Esse é o gatilho para a tela oferecer a transferência.
- **Mudar a taxa ou o dono só vale para os próximos pedidos.** A comissão de cada pedido fica congelada no momento em que o pedido entra. Vale avisar isso na tela de edição.

---

## 5. Comissão do afiliado nos relatórios

**Como nasce.** Quando um pedido do site chega com cupom, o sistema procura quem era o dono ativo do cupom na data do pedido.

- **Cálculo:** a comissão do afiliado é `(produtos − desconto do pedido) × taxa`.
- **Congelamento:** depois de gravada, nunca é recalculada.
- **Um afiliado por pedido:** se o pedido tiver mais de um cupom com dono, só o primeiro gera comissão.

Nada disso tem tela: é automático.

**Só pedido faturado.** É a mesma regra da comissão de vendedor. Pedido em aberto, ou sem nota de venda, continua contando como venda, mas com comissão de afiliado `0` até ser faturado.

**A comissão do afiliado é custo.** Ela já está somada em custo total, lucro, contribuição e valor líquido em todos os relatórios. O front **não** deve subtraí-la de novo; os campos novos servem só para exibir o valor.

### Filtro novo: `affiliatedIds`

Aceito em `GET /api/sales-report` e `GET /api/seller-report`. Recebe ids de contatos afiliados, um só ou repetido (`affiliatedIds[]=uuid1&affiliatedIds[]=uuid2`); `affiliated_ids` também funciona. Ele filtra os pedidos pelo afiliado congelado no pedido.

### Campos novos por relatório

| Relatório | Campo novo |
|---|---|
| `GET /api/sales-report` | `affiliated_comission` em `general` e em cada linha de `byProduct` e `byUnitBusiness`. |
| `GET /api/sales-invoiced-report` | `summary.affiliated_comission`. |
| `GET /api/seller-report` | `summary.affiliated_comission`, e `affiliated_comission` em cada linha de `byStore`, `bySeller` e `customers`. Lista nova `byAffiliated` (abaixo). No `ranking` de produtos, `commission_value` agora soma vendedor + afiliado. |
| `GET /api/seller-commission-report` | Em cada linha: `affiliated_name` (`null` sem afiliado) e `affiliated_commission_value` (`0` sem afiliado). No `summary`: `total_affiliated_commission`. |
| `GET /api/orders/:id/sales-report` | `affiliatedCommission` (já dentro de `totalCost`/`profit`). |

**`byAffiliated`** (relatório de vendedores), uma linha por afiliado, da maior venda para a menor:

```json
{
  "affiliated_id": "uuid",
  "affiliated_name": "Fulano",
  "coupon_codes": "PROMO10, FULANO5",
  "sales_count": 12,
  "total_sold": 4530.9,
  "commission_base": 4300,
  "affiliated_comission": 215
}
```

**Atenção às mudanças de soma**

- **Relatório de vendedores:** pedido só de afiliado (site com cupom, sem vendedor) agora **entra** no relatório. Ele soma em `summary`, `byStore`, `customers`, `ranking` e `byAffiliated`, mas **não** aparece em `bySeller`. Por isso a soma de `bySeller` pode ficar menor que o `summary`.
- **Comissão de vendedor:** o mesmo tipo de pedido aparece como linha **sem vendedor**, só com a parte do afiliado. `summary.total_commission` passa a somar vendedor + gerente da loja + regional + afiliado.

---

## 6. Relatório do afiliado: `GET /api/affiliated-report`

É a tela do **afiliado logado** (login de afiliado). Ele vê as próprias vendas e a própria comissão, e nada além disso: nenhum dado de cliente, custo, lucro ou da empresa.

- **Autenticação:** o cookie `token` do login de afiliado.
- **Escopo:** o backend descobre o afiliado pelo usuário logado. A rota não aceita id de afiliado, então um afiliado nunca vê as vendas de outro.
- **Base:** é a mesma do relatório de vendedores, com período pela data do pedido e só vendas válidas.

**Query**: `start_date` e `end_date`, obrigatórios, no formato `YYYY-MM-DD`; os dois dias entram inteiros.

**Resposta `200`**

```json
{
  "summary": { "total_commission": 215.5 },
  "coupons": [
    { "code": "FULANO5", "commission_rate": 5 }
  ],
  "orders": [
    {
      "order_id": "uuid",
      "order_date": "2026-10-05",
      "order_number": "100045678",
      "total_sold": 1250.9,
      "commission": 62.55,
      "products": [
        { "name": "Pneu 205/55 R16 ...", "quantity": 4 }
      ]
    }
  ]
}
```

- `summary.total_commission`: soma da comissão do afiliado no período.
- `coupons`: cupons **ativos** do afiliado com a taxa de comissão em percentual (`5` = 5%). Não depende do período: mostra o que vale hoje. Cupom inativado, ou vínculo transferido para outro afiliado, não aparece.
- `orders`: um item por pedido, do mais recente para o mais antigo.
  - `order_number` é o número do pedido no site.
  - `total_sold` é o valor da venda, já com desconto.
  - `products` traz nome e quantidade.
  - `commission` é a comissão dele naquele pedido.
- **Pedido ainda não faturado:** aparece na lista com `commission: 0`. A comissão entra quando o pedido é faturado, no próximo processamento dos relatórios.
- **Taxa e comissão podem não bater:** a comissão de cada pedido é a que foi congelada quando o pedido entrou, então pode ser diferente da taxa atual do cupom.

**Erros**

| Status | Quando | Corpo |
|---|---|---|
| `400` | Data ausente, em formato errado ou invertida | `{ "error": "Data inicial é obrigatória; ..." }` |
| `401` | Sem cookie / sessão expirada | `{ "error": "Não autenticado" }` |
| `403` | Usuário logado não é afiliado | `{ "error": "Usuário sem acesso a este relatório" }` |
