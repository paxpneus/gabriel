import { ProductErpData } from "../../../../integrations/integration-mapping/integration-mapping.types";
import { TCarProdutoPayload } from "../../service/tecinco/tecinco.types";
import { normalizeEan } from "./product.helpers";

// Monta o erp_data (snapshot só-leitura) de um produto Tecinco a partir do payload do sync —
// nome, ean, sku (código de fábrica) e estoque por filial, como a Tecinco mandou (ean só sem os textos de "sem GTIN").
export const buildTecincoProductErpData = (
  data: Pick<TCarProdutoPayload, "epctb_nome" | "epctb_ean" | "epctb_codigofabrica">,
  stocks: NonNullable<ProductErpData["stocks"]>,
): ProductErpData => ({
  name: data.epctb_nome?.trim() || null,
  // "SEM GTIN"/"SEMGTIN"/vazio viram null (normalizeEan) — senão o relatório agruparia todos como o mesmo "EAN".
  ean: normalizeEan(data.epctb_ean ? String(data.epctb_ean) : undefined) ?? null,
  sku: data.epctb_codigofabrica ? String(data.epctb_codigofabrica).trim() || null : null,
  stocks,
  updated_at: new Date().toISOString(),
});
