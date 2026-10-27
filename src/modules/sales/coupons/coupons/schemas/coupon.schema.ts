import { z } from "zod";
import { COUPON_DISCOUNT_TYPES } from "../coupons.types";

// Body do POST /coupons; o código é normalizado (trim + maiúsculas) no service.
export const CreateCouponSchema = z.object({
  code: z
    .string({ error: "Código do cupom é obrigatório" })
    .trim()
    .min(1, "Código do cupom é obrigatório")
    .max(50, "Código do cupom deve ter no máximo 50 caracteres"),
  discount_type: z
    .enum(COUPON_DISCOUNT_TYPES, { error: "Tipo de desconto deve ser percent ou fixed" })
    .nullable()
    .optional(),
  discount_value: z.coerce
    .number()
    .nonnegative("Valor do desconto não pode ser negativo")
    .nullable()
    .optional(),
  active: z.boolean().optional(),
});

// PUT /coupons/:id: mesmos campos, todos opcionais.
export const UpdateCouponSchema = CreateCouponSchema.partial();
