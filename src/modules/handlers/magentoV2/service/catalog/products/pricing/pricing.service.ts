import { magentoApi } from "../../../../api/magentoV2_api";
import {
  buildSearchCriteria,
  buildListAll,
  MagentoSearchParams,
} from "../../../../helpers/magentoV2_params.helper";
import { MagentoTierPrice, MagentoSpecialPrice } from '../index'

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class MagentoProductPricing {

  // ══════════════════════════════════════════════════════════════════════════
  // TIER PRICES (preços por quantidade/grupo)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Lista tier prices de um produto para um grupo de clientes.
   * GET /rest/V1/products/:sku/group-prices/:customerGroupId/tiers
   */
  async listarTierPrices(sku: string, customerGroupId: number): Promise<any> {
    return magentoApi
      .get(`/products/${encodeURIComponent(sku)}/group-prices/${customerGroupId}/tiers`)
      .then((r) => r.data);
  }

  /**
   * Busca tier prices de múltiplos SKUs.
   * POST /rest/V1/products/tier-prices-information
   */
  async buscarTierPricesMultiplos(skus: string[]): Promise<any> {
    return magentoApi
      .post("/products/tier-prices-information", { skus })
      .then((r) => r.data);
  }

  /**
   * Adiciona/atualiza tier prices em bulk.
   * POST /rest/V1/products/tier-prices
   * Response lista apenas os itens que FALHARAM.
   */
  async definirTierPrices(prices: MagentoTierPrice[]): Promise<any> {
    return magentoApi
      .post("/products/tier-prices", { prices })
      .then((r) => r.data);
  }

  /**
   * Remove tier prices em bulk.
   * POST /rest/V1/products/tier-prices-delete
   */
  async deletarTierPrices(prices: MagentoTierPrice[]): Promise<any> {
    return magentoApi
      .post("/products/tier-prices-delete", { prices })
      .then((r) => r.data);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SPECIAL PRICES (preços promocionais)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Busca special prices de múltiplos SKUs.
   * POST /rest/V1/products/special-price-information
   */
  async buscarSpecialPrices(skus: string[]): Promise<any> {
    return magentoApi
      .post("/products/special-price-information", { skus })
      .then((r) => r.data);
  }

  /**
   * Define special prices em bulk.
   * POST /rest/V1/products/special-price
   */
  async definirSpecialPrices(prices: MagentoSpecialPrice[]): Promise<any> {
    return magentoApi
      .post("/products/special-price", { prices })
      .then((r) => r.data);
  }

  /**
   * Remove special prices em bulk.
   * POST /rest/V1/products/special-price-delete
   */
  async deletarSpecialPrices(prices: MagentoSpecialPrice[]): Promise<any> {
    return magentoApi
      .post("/products/special-price-delete", { prices })
      .then((r) => r.data);
  }

 
}

export default new MagentoProductPricing();