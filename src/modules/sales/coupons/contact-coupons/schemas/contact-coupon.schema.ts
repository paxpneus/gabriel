import { z } from "zod";

export const CreateContactCouponSchema = z.object({
  contact_id: z.string().uuid("ID do contato deve ser um UUID válido"),
  coupon_id: z.string().uuid("ID do cupom deve ser um UUID válido"),
  commission_rate: z.coerce
    .number({ error: "Taxa de comissão é obrigatória" })
    .min(0, "Taxa de comissão não pode ser negativa")
    .max(100, "Taxa de comissão não pode passar de 100%"),
});

export const UpdateContactCouponSchema = CreateContactCouponSchema.pick({ commission_rate: true }).strict();

export type CreateContactCouponInput = z.infer<typeof CreateContactCouponSchema>;
