import { z } from "zod";
import { ProductStockFlowQuerySchema } from "../../product-stock-flow/controllers/product-stock-flow.controller";

/** Período igual ao stock flow; afiliado = um id ou vários (`affiliated_id[]=`). */
export const AffiliatesReportQuerySchema = ProductStockFlowQuerySchema.and(
  z.object({
    affiliated_id: z
      .union([z.uuid("Afiliado inválido"), z.array(z.uuid("Afiliado inválido"))])
      .optional()
      .transform((value) => (value === undefined ? undefined : [value].flat())),
  }),
);
