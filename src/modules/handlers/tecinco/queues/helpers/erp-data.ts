import { ProductErpData } from "../../../../integrations/integration-mapping/integration-mapping.types";
import { TCarProdutoPayload } from "../../service/tecinco/tecinco.types";

// Monta o erp_data (snapshot só-leitura) de um produto Tecinco a partir do payload do sync —
// nome, ean, sku (código de fábrica) e estoque por filial, crus como a Tecinco mandou.
export const buildTecincoProductErpData = (
  data: Pick<TCarProdutoPayload, "epctb_nome" | "epctb_ean" | "epctb_codigofabrica">,
  stocks: NonNullable<ProductErpData["stocks"]>,
): ProductErpData => ({
  name: data.epctb_nome?.trim() || null,
  ean: data.epctb_ean ? String(data.epctb_ean).trim() || null : null,
  sku: data.epctb_codigofabrica ? String(data.epctb_codigofabrica).trim() || null : null,
  stocks,
  updated_at: new Date().toISOString(),
});
