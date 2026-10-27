import { ProductErpData } from "../../../../../integrations/integration-mapping/integration-mapping.types";

// Monta o erp_data (snapshot só-leitura) de um produto Bling a partir do payload que o sync já buscou
// — nome, ean, ean embalagem, sku e estoque físico, crus como a Bling mandou.
export const buildBlingProductErpData = (
  blingProduct: { nome?: string; codigo?: string; gtin?: string; gtinEmbalagem?: string },
  physicalStock: number,
): ProductErpData => ({
  name: blingProduct.nome?.trim() || null,
  ean: blingProduct.gtin?.trim() || null,
  ean_package: blingProduct.gtinEmbalagem?.trim() || null,
  sku: blingProduct.codigo?.trim() || null,
  stock: physicalStock,
  updated_at: new Date().toISOString(),
});
