# Contact (`contacts`)

`src/modules/sales/contacts/`. Vendedor/cliente/afiliado. Ligado opcionalmente a um `users` (`user_id`, unique `contacts_user_id_unique`).

## Campos

- `type`: `CONTACT_TYPES = ["SELLER","CUSTOMER","AFFILIATED"]` (`contacts.types.ts`, mesma constante no model e no Zod). `AFFILIATED` entrou em m322.
- `id_system`: **opcional** desde m323 (contatos de `/with-user` não têm id do Bling). Quem lê assume possível `null`: `invoice.service.ts` devolve `?? ""` (contrato string); `createUserFromSellerName` (legado, usa `id_system` como CPF) lança "Vendedor ... sem id_system cadastrado".
- `custom_data`: JSONB genérico (default `{}`), m323. `ContactService.update` faz **merge** (`{ ...atual, ...novo }`), nunca substitui. Não guarda cupom nem taxa (isso é `contact_coupons`, ver `coupon.md`).
- `document`: unique; em `/with-user` recebe o CPF do user.
- Index: `filterableFields: ['type','unit_business_id']` → `filters[type]=AFFILIATED` lista afiliados.

## `POST /api/contacts/with-user`

`[authenticate, validateCreate(CreateContactWithUserSchema), userPermissions]` → 201 / 400 `{ error }`. Body: `name`, `cpf`, `email`, `password` (obrigatórios, `RequiredUserFields` do user schema), `phone?`, `type`, `unit_business_id?`, `custom_data?`.

- `CONTACT_USER_TYPE_CONFIG` (no `contacts.service.ts`): `AFFILIATED` → user type `affiliated`, role "Afiliado", loja fixa `CD21_UNIT_BUSINESS_NUMBER` (ignora `unit_business_id` do body); `SELLER` → `seller`, role "Vendedor", exige `unit_business_id`. Outro tipo → "Tipo de contato ... não permite criar usuário".
- Uma transação: role (por nome) → loja → `userService.createUserWithValidation(dto, t)` → Contact sem `id_system`. Resposta `{ contact, user }` sem senha. `UniqueConstraintError` em `user_id`/`document` vira mensagem amigável.

## Afiliado

- Sempre loja 21. Login/me próprios em `affiliated/` (montado pelo `contacts.controller` em `/affiliated`; sem `*.routes.ts` porque o loader de rotas para no primeiro `*.routes.ts` da pasta) — ver `../modules/auth.md` § "Login do afiliado".
- Comissão por cupom: `contact_coupons`/`order_coupons` — ver `coupon.md`.
