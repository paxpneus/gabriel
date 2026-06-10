import { magentoApi } from "../../../../api/magentoV2_api";
import {
  buildSearchCriteria,
  buildListAll,
  MagentoSearchParams,
} from "../../../../helpers/magentoV2_params.helper";

import { MagnentoCategoryPayload } from "../index";
// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class MagentoProductCategories {
  // ══════════════════════════════════════════════════════════════════════════
  // CATEGORIAS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Retorna a árvore de categorias.
   * GET /rest/V1/categories
   */
  async listarArvoreCategoria(rootCategoryId?: number): Promise<any> {
    const params = rootCategoryId ? { rootCategoryId } : {};
    return magentoApi.get("/categories", { params }).then((r) => r.data);
  }

  /**
   * Lista categorias com searchCriteria.
   * GET /rest/V1/categories/list
   */
  async listarCategorias(search: MagentoSearchParams = {}): Promise<any> {
    const params = buildSearchCriteria(search);
    return magentoApi.get("/categories/list", { params }).then((r) => r.data);
  }

  /**
   * Obtém uma categoria pelo ID.
   * GET /rest/V1/categories/:categoryId
   */
  async obterCategoria(categoryId: number): Promise<any> {
    return magentoApi.get(`/categories/${categoryId}`).then((r) => r.data);
  }

  /**
   * Cria uma categoria.
   * POST /rest/V1/categories
   */
  async criarCategoria(category: MagnentoCategoryPayload): Promise<any> {
    return magentoApi.post("/categories", { category }).then((r) => r.data);
  }

  /**
   * Atualiza uma categoria.
   * PUT /rest/V1/categories/:categoryId
   */
  async atualizarCategoria(
    categoryId: number,
    category: Partial<MagnentoCategoryPayload>,
  ): Promise<any> {
    return magentoApi
      .put(`/categories/${categoryId}`, { category })
      .then((r) => r.data);
  }

  /**
   * Remove uma categoria.
   * DELETE /rest/V1/categories/:categoryId
   */
  async deletarCategoria(categoryId: number): Promise<any> {
    return magentoApi.delete(`/categories/${categoryId}`).then((r) => r.data);
  }

  /**
   * Move uma categoria na árvore.
   * PUT /rest/V1/categories/:categoryId/move
   */
  async moverCategoria(
    categoryId: number,
    parentId: number,
    afterId?: number,
  ): Promise<any> {
    return magentoApi
      .put(`/categories/${categoryId}/move`, { parentId, afterId })
      .then((r) => r.data);
  }

  /**
   * Lista produtos de uma categoria.
   * GET /rest/V1/categories/:categoryId/products
   */
  async listarProdutosCategoria(categoryId: number): Promise<any> {
    return magentoApi
      .get(`/categories/${categoryId}/products`)
      .then((r) => r.data);
  }

  /**
   * Atribui um produto a uma categoria.
   * POST /rest/V1/categories/:categoryId/products
   */
  async atribuirProdutoCategoria(
    categoryId: number,
    sku: string,
    position?: number,
  ): Promise<any> {
    return magentoApi
      .post(`/categories/${categoryId}/products`, {
        productLink: { sku, position: position ?? 0, category_id: String(categoryId) },
      })
      .then((r) => r.data);
  }

  /**
   * Atualiza posição de um produto em uma categoria.
   * PUT /rest/V1/categories/:categoryId/products
   */
  async atualizarProdutoCategoria(
    categoryId: number,
    sku: string,
    position: number,
  ): Promise<any> {
    return magentoApi
      .put(`/categories/${categoryId}/products`, {
        productLink: { sku, position, category_id: String(categoryId) },
      })
      .then((r) => r.data);
  }

  /**
   * Remove um produto de uma categoria.
   * DELETE /rest/V1/categories/:categoryId/products/:sku
   */
  async removerProdutoCategoria(categoryId: number, sku: string): Promise<any> {
    return magentoApi
      .delete(`/categories/${categoryId}/products/${encodeURIComponent(sku)}`)
      .then((r) => r.data);
  }

}

export default new MagentoProductCategories();