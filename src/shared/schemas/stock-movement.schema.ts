import { z } from "zod";

/**
 * Schema para criar um ajuste manual de stock movement
 * (POST /stock-movements/:productId/manual-adjustment).
 *
 * Regra de negócio: se `direction_type` for SALE_OUT (ajuste referenciando
 * nota de saída), `manual_average_cost_value` não pode ser informado e
 * `movement_quantity` passa a ser obrigatório. Se for PURCHASE_ENTRY (nota
 * de entrada), o usuário pode informar só `movement_quantity`, só
 * `manual_average_cost_value`, ou os dois — mas pelo menos um dos dois.
 *
 * `movement_date` não é aceito aqui: a data do ajuste é sempre calculada no
 * back-end a partir da movimentação referenciada por `refers_to` (mesmo dia,
 * 5 segundos à frente dela) — ver `createManualAdjustment` no service.
 */
export const CreateStockMovementSchema = z
  .object({
    unit_business_id: z
      .string({ error: "Unidade de negócio é obrigatória" })
      .uuid("Unidade de negócio deve ser um identificador válido"),

    direction_type: z.enum(["PURCHASE_ENTRY", "SALE_OUT"], {
      error:
        "Direção do ajuste é obrigatória e deve ser entrada (PURCHASE_ENTRY) ou saída (SALE_OUT)",
    }),

    movement_quantity: z
      .coerce.number()
      .nonnegative("Quantidade da movimentação não pode ser negativa")
      .optional(),

    manual_average_cost_value: z
      .coerce.number()
      .positive("Custo médio manual deve ser maior que zero")
      .nullable()
      .optional(),

    refers_to: z
      .string({ error: "Referência de nota fiscal para ajuste é obrigatória" })
      .max(100, "Referência de nota fiscal para ajuste deve ter no máximo 100 caracteres"),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.direction_type === "SALE_OUT") {
      if (data.manual_average_cost_value != null) {
        ctx.addIssue({
          code: "custom",
          path: ["manual_average_cost_value"],
          message:
            "Ajuste referenciando nota de saída não pode ter custo médio manual preenchido",
        });
      }

      if (data.movement_quantity == null) {
        ctx.addIssue({
          code: "custom",
          path: ["movement_quantity"],
          message:
            "Quantidade da movimentação é obrigatória para ajuste referenciando nota de saída",
        });
      }
    }

    if (data.direction_type === "PURCHASE_ENTRY") {
      if (data.movement_quantity == null && data.manual_average_cost_value == null) {
        ctx.addIssue({
          code: "custom",
          path: ["movement_quantity"],
          message:
            "Informe a quantidade da movimentação e/ou o custo médio manual para ajuste referenciando nota de entrada",
        });
      }
    }
  })
  .transform((data) => ({
    ...data,
    movement_quantity: data.movement_quantity ?? 0,
  }));

export type CreateStockMovementInput = z.infer<typeof CreateStockMovementSchema>;

/**
 * Schema para atualizar o custo médio manual de um stock movement
 * (PATCH /stock-movements/:productId/manual-average-cost/:movementId).
 *
 * `manual_average_cost_value` pode ser `null` pra remover o override.
 */
export const UpdateStockMovementSchema = z
  .object({
    unit_business_id: z
      .string({ error: "Unidade de negócio é obrigatória" })
      .uuid("Unidade de negócio deve ser um identificador válido"),

    manual_average_cost_value: z
      .coerce.number({ error: "Custo médio manual é obrigatório" })
      .positive("Custo médio manual deve ser maior que zero")
      .nullable(),

    refers_to: z
      .string({ error: "Referência de nota fiscal para ajuste é obrigatória" })
      .max(100, "Referência de nota fiscal para ajuste deve ter no máximo 100 caracteres"),
  })
  .strict();

export type UpdateStockMovementInput = z.infer<typeof UpdateStockMovementSchema>;
