import { z } from "zod";

// Body do POST /contact-coupons e do POST /contact-coupons/transfer.
export const CreateContactCouponSchema = z.object({
  contact_id: z.string({ error: "Afiliado é obrigatório" }).uuid("Afiliado inválido"),
  coupon_id: z.string({ error: "Cupom é obrigatório" }).uuid("Cupom inválido"),
  commission_rate: z.coerce
    .number({ error: "Taxa de comissão é obrigatória" })
    .min(0, "Taxa de comissão não pode ser negativa")
    .max(100, "Taxa de comissão não pode passar de 100"),
});

// PUT /contact-coupons/:id: só a taxa muda (afiliado/cupom trocam via transfer).
export const UpdateContactCouponSchema = CreateContactCouponSchema.pick({
  commission_rate: true,
}).strict();
