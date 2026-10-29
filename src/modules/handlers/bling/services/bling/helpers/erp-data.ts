import { ProductErpData } from "../../../../../integrations/integration-mapping/integration-mapping.types";
import { normalizeEan } from "../../../../tecinco/queues/helpers/product.helpers";

// Monta o erp_data (snapshot só-leitura) de um produto Bling a partir do payload que o sync já buscou
// — nome, ean, ean embalagem, sku e estoque físico, crus como a Bling mandou.
export const buildBlingProductErpData = (
  blingProduct: { nome?: string; codigo?: string; gtin?: string; gtinEmbalagem?: string },
  physicalStock: number,
): ProductErpData => ({
  name: blingProduct.nome?.trim() || null,
  // "SEM GTIN"/vazio viram null (normalizeEan) — senão o relatório agruparia todos como o mesmo "EAN duplicado".
  ean: normalizeEan(blingProduct.gtin) ?? null,
  ean_package: blingProduct.gtinEmbalagem?.trim() || null,
  sku: blingProduct.codigo?.trim() || null,
  stock: physicalStock,
  updated_at: new Date().toISOString(),
});
