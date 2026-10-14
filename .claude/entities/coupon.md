# Coupon / ContactCoupon / OrderCoupon

`src/modules/sales/coupons/` — `coupons/` (`/api/coupons`), `contact-coupons/` (`/api/contact-coupons`), `order-coupons/` (sem rota). Permissão `coupons` ("Cupons", filho `contact_coupons`). Tabelas em `m321`.

## Schema
- `coupons`: `code` (unique, gravado trim+uppercase — `normalizeCouponCode`), `discount_type` (`percent`|`fixed`) e `discount_value` **nullable** (cupom criado automaticamente pela Magento nasce sem), `active` (vale no checkout). Cupom é genérico: pode não ter afiliado.
- `contact_coupons` (vínculo afiliado ↔ cupom): `contact_id`, `coupon_id`, `commission_rate`, `active`, `deactivated_at`. `UNIQUE (coupon_id) WHERE active` = um dono ativo por cupom; afiliado pode ter vários cupons ativos.
- `order_coupons` (PK `order_id`+`coupon_id`): `contact_coupon_id` (null = sem afiliado), `discount_amount`, `commission_rate`, `commission_amount` — snapshot gravado uma vez, **nunca recalculado**. `UNIQUE (order_id) WHERE contact_coupon_id IS NOT NULL` = no máximo um afiliado por pedido.
- FKs `RESTRICT` (pedido é `CASCADE`). Nada é deletado: `DELETE`/bulk dos controllers respondem 405 (`helpers/not-allowed-handlers.ts`); inativar = `active=false` (+ `deactivated_at` no vínculo).

## Regras
- Só contact `AFFILIATED` tem vínculo (`ContactCouponService.assertAffiliated`).
- Vínculo: `POST /api/contact-coupons` (erro se o cupom já tem dono ativo), `POST /transfer` (inativa o dono atual + cria o novo numa transação), `PATCH /:id/deactivate`, `PUT /:id` só `commission_rate` (vale pros próximos pedidos). Troca de cupom do afiliado = front cria cupom + vínculo novo e inativa o antigo.
- Cupom: `PATCH /api/coupons/:id/deactivate|activate`.

## Registro no pedido (`OrderCouponService.registerFromMagento`)
Chamado pelo job `fetch-order` da `MAGENTO_SYNC` (ver `modules/magento-sync.md`), numa transação:
1. `couponService.findOrCreateByCode` — cupom desconhecido é criado ativo, sem desconto.
2. Já existe linha pedido+cupom → não faz nada.
3. Cupom ativo → dono = `contactCouponService.findOwnerAt(coupon, ref)`: vínculo com `created_at <= ref` e (`deactivated_at` null ou `> ref`). `ref` = `couponOwnerReferenceDate` (`orders.created_at` limitado ao fim do dia de `orders.date` — `date` só tem o dia). Cupom inativo → sem dono (só desconto).
4. Pedido já com afiliado → cupom novo grava só desconto (loga).
5. `commission_amount = ROUND(orderNetProductsAmount(order) × rate / 100, 2)` — mesma base do vendedor (`total_products` − desconto do pedido, `orders/order/helpers/discount.ts`).
6. `ordersService.touch(orderId)` pros jobs incrementais dos relatórios reprocessarem.

Relatórios leem a comissão congelada via `order-coupons/helpers/affiliated-commission-sql.ts` (`orderAffiliateJoinSql`), sem filtrar `active` — ver `modules/reports.md`.
