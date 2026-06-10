import { magentoApi } from "../../../../api/magentoV2_api";
import {
  buildSearchCriteria,
  buildListAll,
  MagentoSearchParams,
} from "../../../../helpers/magentoV2_params.helper";
import { MagentoConfigurableOption } from '../index'
// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class MagentoProductConfigurable {

  // ══════════════════════════════════════════════════════════════════════════
  // PRODUTOS CONFIGURÁVEIS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Lista filhos (simples) de um produto configurável.
   * GET /rest/V1/configurable-products/:sku/children
   */
  async listarFilhosConfiguravel(sku: string): Promise<any> {
    return magentoApi
      .get(`/configurable-products/${encodeURIComponent(sku)}/children`)
      .then((r) => r.data);
  }

  /**
   * Atribui um produto simples a um configurável.
   * POST /rest/V1/configurable-products/:sku/child
   */
  async atribuirFilhoConfiguravel(
    sku: string,
    childSku: string,
  ): Promise<any> {
    return magentoApi
      .post(`/configurable-products/${encodeURIComponent(sku)}/child`, {
        childSku,
      })
      .then((r) => r.data);
  }

  /**
   * Remove um produto simples de um configurável.
   * DELETE /rest/V1/configurable-products/:sku/children/:childSku
   */
  async removerFilhoConfiguravel(sku: string, childSku: string): Promise<any> {
    return magentoApi
      .delete(
        `/configurable-products/${encodeURIComponent(sku)}/children/${encodeURIComponent(childSku)}`,
      )
      .then((r) => r.data);
  }

  /**
   * Lista todas as opções de um produto configurável.
   * GET /rest/V1/configurable-products/:sku/options/all
   */
  async listarOpcoesConfiguravel(sku: string): Promise<any> {
    return magentoApi
      .get(`/configurable-products/${encodeURIComponent(sku)}/options/all`)
      .then((r) => r.data);
  }

  /**
   * Obtém uma opção específica de um produto configurável.
   * GET /rest/V1/configurable-products/:sku/options/:id
   */
  async obterOpcaoConfiguravel(sku: string, optionId: number): Promise<any> {
    return magentoApi
      .get(
        `/configurable-products/${encodeURIComponent(sku)}/options/${optionId}`,
      )
      .then((r) => r.data);
  }

  /**
   * Adiciona uma opção a um produto configurável.
   * POST /rest/V1/configurable-products/:sku/options
   */
  async criarOpcaoConfiguravel(
    sku: string,
    option: MagentoConfigurableOption,
  ): Promise<any> {
    return magentoApi
      .post(`/configurable-products/${encodeURIComponent(sku)}/options`, {
        option,
      })
      .then((r) => r.data);
  }

  /**
   * Atualiza uma opção de um produto configurável.
   * PUT /rest/V1/configurable-products/:sku/options/:id
   */
  async atualizarOpcaoConfiguravel(
    sku: string,
    optionId: number,
    option: Partial<MagentoConfigurableOption>,
  ): Promise<any> {
    return magentoApi
      .put(
        `/configurable-products/${encodeURIComponent(sku)}/options/${optionId}`,
        { option },
      )
      .then((r) => r.data);
  }

  /**
   * Remove uma opção de um produto configurável.
   * DELETE /rest/V1/configurable-products/:sku/options/:id
   */
  async deletarOpcaoConfiguravel(sku: string, optionId: number): Promise<any> {
    return magentoApi
      .delete(
        `/configurable-products/${encodeURIComponent(sku)}/options/${optionId}`,
      )
      .then((r) => r.data);
  }
}

export default new MagentoProductConfigurable();