import { z } from "zod";
import { COUPON_DISCOUNT_TYPES } from "../coupons.types";

export const CreateCouponSchema = z.object({
  code: z.string({ error: "Código é obrigatório" }).trim().min(1, "Código é obrigatório").max(50, "Código não pode ter mais de 50 caracteres"),
  discount_type: z.enum(COUPON_DISCOUNT_TYPES, { error: "Tipo de desconto inválido" }).nullable().optional(),
  discount_value: z.coerce.number().min(0, "Desconto não pode ser negativo").nullable().optional(),
  active: z.boolean().optional(),
});

export const UpdateCouponSchema = CreateCouponSchema.partial();

export type CreateCouponInput = z.infer<typeof CreateCouponSchema>;
