import { magentoApi } from "../../../api/magentoV2_api";
import {
  buildSearchCriteria,
  buildListAll,
  MagentoSearchParams,
} from "../../../helpers/magentoV2_params.helper";
import { MagentoProductPayload, MagentoLinkType } from "./products.types";


// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class MagentoCatalogService {

  // ══════════════════════════════════════════════════════════════════════════
  // PRODUTOS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Lista produtos com searchCriteria.
   * GET /rest/V1/products
   */
  async listarProdutos(search: MagentoSearchParams = {}): Promise<any> {
    const params = buildSearchCriteria(search);
    return magentoApi.get("/products", { params }).then((r) => r.data);
  }

  /**
   * Atalho: lista todos os produtos paginados.
   * GET /rest/V1/products
   */
  async listarTodosProdutos(pageSize = 100, currentPage = 1): Promise<any> {
    const params = buildListAll(pageSize, currentPage);
    return magentoApi.get("/products", { params }).then((r) => r.data);
  }

  /**
   * Obtém produto por SKU.
   * GET /rest/V1/products/:sku
   */
  async obterProduto(sku: string): Promise<any> {
    return magentoApi
      .get(`/products/${encodeURIComponent(sku)}`)
      .then((r) => r.data);
  }

  /**
   * Cria um produto.
   * POST /rest/V1/products
   * Body requer sku, attribute_set_id, type_id.
   */
  async criarProduto(product: MagentoProductPayload): Promise<any> {
    return magentoApi.post("/products", { product }).then((r) => r.data);
  }

  /**
   * Atualiza um produto existente.
   * PUT /rest/V1/products/:sku
   */
  async atualizarProduto(
    sku: string,
    product: Partial<MagentoProductPayload>,
  ): Promise<any> {
    return magentoApi
      .put(`/products/${encodeURIComponent(sku)}`, { product })
      .then((r) => r.data);
  }

  /**
   * Atualiza um custom_attribute específico de um produto.
   * PUT /rest/V1/products/:sku (wrapper conveniente)
   */
  async atualizarCustomAttribute(
    sku: string,
    attributeCode: string,
    value: string | number,
  ): Promise<any> {
    return this.atualizarProduto(sku, {
      custom_attributes: [{ attribute_code: attributeCode, value }],
    });
  }

  /**
   * Remove um produto pelo SKU. (Admin only)
   * DELETE /rest/V1/products/:sku
   */
  async deletarProduto(sku: string): Promise<any> {
    return magentoApi
      .delete(`/products/${encodeURIComponent(sku)}`)
      .then((r) => r.data);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // LINKS DE PRODUTO (related / upsell / crosssell)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Lista links de um produto por tipo.
   * GET /rest/V1/products/:sku/links/:type
   */
  async listarLinksProduto(sku: string, type: MagentoLinkType): Promise<any> {
    return magentoApi
      .get(`/products/${encodeURIComponent(sku)}/links/${type}`)
      .then((r) => r.data);
  }

  /**
   * Atribui links a um produto.
   * POST /rest/V1/products/:sku/links
   */
  async criarLinksProduto(sku: string, items: object[]): Promise<any> {
    return magentoApi
      .post(`/products/${encodeURIComponent(sku)}/links`, { items })
      .then((r) => r.data);
  }

  /**
   * Atualiza links de um produto.
   * PUT /rest/V1/products/:sku/links
   */
  async atualizarLinksProduto(sku: string, items: object[]): Promise<any> {
    return magentoApi
      .put(`/products/${encodeURIComponent(sku)}/links`, { items })
      .then((r) => r.data);
  }

  /**
   * Remove um link específico.
   * DELETE /rest/V1/products/:sku/links/:type/:linkedProductSku
   */
  async deletarLinkProduto(
    sku: string,
    type: MagentoLinkType,
    linkedSku: string,
  ): Promise<any> {
    return magentoApi
      .delete(
        `/products/${encodeURIComponent(sku)}/links/${type}/${encodeURIComponent(linkedSku)}`,
      )
      .then((r) => r.data);
  }

}

export default new MagentoCatalogService();