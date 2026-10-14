# Contact

`src/modules/sales/contacts/` — rotas em `/api/contacts`, permissão `contacts` ("Contatos" em `ROLE_PERMISSIONS`).

## Schema
- `type` ENUM `SELLER` | `CUSTOMER` | `AFFILIATED` (`CONTACT_TYPES` em `contacts.types.ts`; valor novo de enum = migration `ALTER TYPE enum_contacts_type ADD VALUE`, fora de transação — `m317`).
- `custom_data` JSONB (default `{}`), genérico. `PUT /api/contacts/:id` com `custom_data` faz **merge** com o JSON atual (`ContactService.update`); schema opcional por tipo em `helpers/contact-user-types.ts` (`customDataSchema`, nenhum tipo usa hoje).
- `id_system` (id no sistema externo, ex. vendedor Bling) é **nullable** desde `m318`; contact criado pela rota user+contact não tem. Fluxo `create-from-seller-name` exige (usa como CPF).
- `user_id` (unique) → `users`; `User.hasOne(Contact, as "contact")`.
- `document` é `unique` no model mas **não** no DB (índice comum, `m208`).

## User + Contact (`POST /api/contacts/with-user`)
- `authenticate` + `validateCreate(CreateContactWithUserSchema)` + `userPermissions` (write em `contacts`). Obrigatórios: `name`, `cpf`, `email`, `password` (`RequiredUserFields`, `company/users/users/schemas/user.schema.ts`; schema da rota em `contacts/schemas/contact.schema.ts`); `phone` opcional.
- Config por tipo em `CONTACT_USER_TYPE_CONFIG` (`helpers/contact-user-types.ts`): `userType`, `roleName`, `fixedUnitBusinessNumber` (loja fixa, ignora body), `customDataSchema`. Tipo novo com usuário = entrada nova ali.
  - `AFFILIATED` → `user_config.type = "affiliated"`, role `"Afiliado"` (seed `m323`), loja `CD21_UNIT_BUSINESS_NUMBER` sempre.
  - `SELLER` → `"seller"`, role `"Vendedor"`, `unit_business_id` obrigatório no body.
  - `CUSTOMER` não cria usuário.
- `ContactService.createWithUser`: uma transação (`userService.createUserWithValidation(dto, t)` aceita transação externa) → contact com `document = cpf` e **sem** `id_system`. Resposta não traz senha.
- Rota legada `POST /create-from-seller-name` (vendedor já existente do Bling) continua igual e sem auth.

## Afiliado
- Login/me próprios em `/api/contacts/affiliated` (`src/modules/sales/contacts/affiliated/`, router montado dentro do de contacts — o loader de rotas não monta subpasta de módulo): `POST /login` (`userService.loginAs(..., "affiliated")`, cookie `token` igual ao login padrão) e `GET /me` (`authenticate`); ambos devolvem só `{ name, unit_business: { number, name } }`. `POST /api/users/login` recusa `type === "affiliated"`.
- Cupons e taxa de comissão **não** ficam em `custom_data`: vínculo em `contact_coupons`, snapshot por pedido em `order_coupons` — ver `entities/coupon.md`. Comissão nos relatórios: `modules/reports.md`.
