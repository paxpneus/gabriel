import { ProductStockFlowQuerySchema } from "../../product-stock-flow/controllers/product-stock-flow.controller";

/** Período do relatório do afiliado: datas do stock flow, no máximo 1 ano (fim antes do mesmo dia do ano seguinte, ex.: 01/01 a 31/12). */
export const AffiliatedReportQuerySchema = ProductStockFlowQuerySchema.refine(
  (query) => {
    const limit = new Date(`${query.start_date}T00:00:00Z`);
    limit.setUTCFullYear(limit.getUTCFullYear() + 1);
    return new Date(`${query.end_date}T00:00:00Z`) < limit;
  },
  { message: "O período não pode ser maior que 1 ano", path: ["end_date"] },
);
