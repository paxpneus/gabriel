import { magentoApi } from "../../../../api/magentoV2_api";
import {
  buildSearchCriteria,
  buildListAll,
  MagentoSearchParams,
} from "../../../../helpers/magentoV2_params.helper";
import { MagentoMediaEntry } from '../index'
// ─────────────────────────────────────────────────────────────────────────────
// Types mínimos (expanda conforme necessário)
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class MagentoProductMedia {

  // ══════════════════════════════════════════════════════════════════════════
  // MEDIA (imagens/vídeos do produto)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Lista entradas de mídia de um produto.
   * GET /rest/V1/products/:sku/media
   */
  async listarMediaProduto(sku: string): Promise<any> {
    return magentoApi
      .get(`/products/${encodeURIComponent(sku)}/media`)
      .then((r) => r.data);
  }

  /**
   * Faz upload de mídia para um produto.
   * POST /rest/V1/products/:sku/media
   * entry.content aceita base64; ou use remote para URL.
   */
  async uploadMediaProduto(sku: string, entry: MagentoMediaEntry): Promise<any> {
    return magentoApi
      .post(`/products/${encodeURIComponent(sku)}/media`, { entry })
      .then((r) => r.data);
  }

  /**
   * Atualiza uma entrada de mídia existente.
   * PUT /rest/V1/products/:sku/media/:entryId
   */
  async atualizarMediaProduto(
    sku: string,
    entryId: number,
    entry: Partial<MagentoMediaEntry>,
  ): Promise<any> {
    return magentoApi
      .put(`/products/${encodeURIComponent(sku)}/media/${entryId}`, { entry })
      .then((r) => r.data);
  }

  /**
   * Remove uma entrada de mídia.
   * DELETE /rest/V1/products/:sku/media/:entryId
   */
  async deletarMediaProduto(sku: string, entryId: number): Promise<any> {
    return magentoApi
      .delete(`/products/${encodeURIComponent(sku)}/media/${entryId}`)
      .then((r) => r.data);
  }

}

export default new MagentoProductMedia();