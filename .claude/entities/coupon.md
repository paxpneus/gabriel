# Coupon / ContactCoupon / OrderCoupon (cupom + afiliado)

`src/modules/sales/coupons/` — `coupons/`, `contact-coupons/`, `order-coupons/` (sem rotas). Migration `m326`.

## Tabelas
- `coupons`: `code` UNIQUE (sempre `trim().toUpperCase()` — `CouponService.normalizeCode` no create/update/`findOrCreateByCode`), `discount_type` (`percent|fixed`, nullable), `discount_value` (nullable), `active`. Cupom genérico: pode não ter afiliado.
- `contact_coupons`: vínculo afiliado (`contacts.type = AFFILIATED`) ↔ cupom com `commission_rate` (%), `active`, `deactivated_at`. Índice parcial `UNIQUE (coupon_id) WHERE active` = um dono ativo por cupom; afiliado pode ter vários cupons.
- `order_coupons`: PK `(order_id, coupon_id)`, `contact_coupon_id` (nullable), `discount_amount`, `commission_rate`, `commission_amount` (congelados), só `created_at`. Índice parcial `UNIQUE (order_id) WHERE contact_coupon_id IS NOT NULL` = no máximo um afiliado por pedido.
- **Nada é apagado**: FKs `RESTRICT` (exceto `order_id` → `CASCADE`); delete/bulk das rotas respondem 405. Cupom e vínculo só são inativados.

## Rotas
- `/api/coupons`: CRUD (`CreateCouponSchema`/`UpdateCouponSchema`), `PATCH /:id/activate|deactivate`. Código duplicado → "Já existe um cupom com este código".
- `/api/contact-coupons`: `POST /` = `link` (valida contato afiliado e cupom; dono ativo já existente → erro sugerindo transferência, inclusive na corrida via `UniqueConstraintError`), `PUT /:id` só `commission_rate` (vale só pros próximos pedidos), `POST /transfer` (inativa o dono atual + `link`, mesma transação), `PATCH /:id/deactivate` (grava `deactivated_at` uma única vez).
- Permissão: `authenticate` + `userPermissions` (tabelas `coupons`/`contact_coupons`).

## Dono na data (`findOwnerAt`)
`contact_coupons` com `created_at <= ref AND (deactivated_at IS NULL OR deactivated_at > ref)`, mais recente primeiro — não filtra `active`, então transferência/inativação posterior não muda o dono de pedido antigo.

Data de referência (`registerFromMagento`): `orders.date` só tem o dia → usa `orders.created_at`, limitado a `date + 24h` (ingestão atrasada/backfill não cai num dono posterior à venda).

## `OrderCouponService.registerFromMagento` (comissão congelada)
Chamado pelo job `fetch-order` da `MAGENTO_SYNC` (ver `../modules/magento-sync.md`):
1. `couponService.findOrCreateByCode` — cupom desconhecido nasce ativo, sem desconto definido.
2. Linha pedido+cupom já existe → retorna `null` sem recalcular nem fazer `touch`.
3. Cupom inativo → sem dono (grava só o desconto). Ativo → `findOwnerAt`.
4. Pedido já tem afiliado por outro cupom → grava este cupom sem afiliado (log em inglês).
5. `commission_amount = round((total_products − desconto do pedido) × rate) / 100`; desconto `PERCENTUAL` = `total_products × valor / 100` (mesma base da comissão do vendedor).
6. `orderService.touch(orderId)` pros jobs incrementais dos relatórios reprocessarem o pedido.

Relatórios leem a comissão gravada via `order-coupons/helpers/affiliated-commission-sql.ts` (`orderAffiliateJoinSql`) — ver `../modules/reports.md`.
