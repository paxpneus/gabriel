import { magentoApi } from "../../../../api/magentoV2_api";
import {
  buildSearchCriteria,
  buildListAll,
  MagentoSearchParams,
} from "../../../../helpers/magentoV2_params.helper";
import { MagentoAttributePayload } from '../index'

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class MagentoProductAttributes {

  /**
   * Lista atributos de produto com searchCriteria.
   * GET /rest/V1/products/attributes
   */
  async listarAtributos(search: MagentoSearchParams = {}): Promise<any> {
    const params = buildSearchCriteria(search);
    return magentoApi
      .get("/products/attributes", { params })
      .then((r) => r.data);
  }

  /**
   * Obtém um atributo pelo código.
   * GET /rest/V1/products/attributes/:attributeCode
   */
  async obterAtributo(attributeCode: string): Promise<any> {
    return magentoApi
      .get(`/products/attributes/${encodeURIComponent(attributeCode)}`)
      .then((r) => r.data);
  }

  /**
   * Cria um atributo de produto.
   * POST /rest/V1/products/attributes
   */
  async criarAtributo(attribute: MagentoAttributePayload): Promise<any> {
    return magentoApi
      .post("/products/attributes", { attribute })
      .then((r) => r.data);
  }

  /**
   * Atualiza um atributo de produto.
   * PUT /rest/V1/products/attributes/:attributeCode
   */
  async atualizarAtributo(
    attributeCode: string,
    attribute: Partial<MagentoAttributePayload>,
  ): Promise<any> {
    return magentoApi
      .put(`/products/attributes/${encodeURIComponent(attributeCode)}`, { attribute })
      .then((r) => r.data);
  }

  /**
   * Remove um atributo de produto.
   * DELETE /rest/V1/products/attributes/:attributeCode
   */
  async deletarAtributo(attributeCode: string): Promise<any> {
    return magentoApi
      .delete(`/products/attributes/${encodeURIComponent(attributeCode)}`)
      .then((r) => r.data);
  }

  /**
   * Lista opções de um atributo (select/multiselect).
   * GET /rest/V1/products/attributes/:attributeCode/options
   */
  async listarOpcoesAtributo(attributeCode: string): Promise<any> {
    return magentoApi
      .get(`/products/attributes/${encodeURIComponent(attributeCode)}/options`)
      .then((r) => r.data);
  }

  /**
   * Adiciona uma opção a um atributo.
   * POST /rest/V1/products/attributes/:attributeCode/options
   */
  async criarOpcaoAtributo(
    attributeCode: string,
    option: { label: string; value?: string; sort_order?: number },
  ): Promise<any> {
    return magentoApi
      .post(`/products/attributes/${encodeURIComponent(attributeCode)}/options`, { option })
      .then((r) => r.data);
  }

  /**
   * Remove uma opção de um atributo.
   * DELETE /rest/V1/products/attributes/:attributeCode/options/:optionId
   */
  async deletarOpcaoAtributo(
    attributeCode: string,
    optionId: string,
  ): Promise<any> {
    return magentoApi
      .delete(
        `/products/attributes/${encodeURIComponent(attributeCode)}/options/${encodeURIComponent(optionId)}`,
      )
      .then((r) => r.data);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // ATTRIBUTE SETS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Lista attribute sets com searchCriteria.
   * GET /rest/V1/products/attribute-sets/sets/list
   */
  async listarAttributeSets(search: MagentoSearchParams = {}): Promise<any> {
    const params = buildSearchCriteria(search);
    return magentoApi
      .get("/products/attribute-sets/sets/list", { params })
      .then((r) => r.data);
  }

  /**
   * Obtém um attribute set pelo ID.
   * GET /rest/V1/products/attribute-sets/:attributeSetId
   */
  async obterAttributeSet(attributeSetId: number): Promise<any> {
    return magentoApi
      .get(`/products/attribute-sets/${attributeSetId}`)
      .then((r) => r.data);
  }

  /**
   * Cria um attribute set.
   * POST /rest/V1/products/attribute-sets
   */
  async criarAttributeSet(attributeSet: object): Promise<any> {
    return magentoApi
      .post("/products/attribute-sets", { attributeSet })
      .then((r) => r.data);
  }

  /**
   * Atualiza um attribute set.
   * PUT /rest/V1/products/attribute-sets/:attributeSetId
   */
  async atualizarAttributeSet(
    attributeSetId: number,
    attributeSet: object,
  ): Promise<any> {
    return magentoApi
      .put(`/products/attribute-sets/${attributeSetId}`, { attributeSet })
      .then((r) => r.data);
  }

  /**
   * Remove um attribute set.
   * DELETE /rest/V1/products/attribute-sets/:attributeSetId
   */
  async deletarAttributeSet(attributeSetId: number): Promise<any> {
    return magentoApi
      .delete(`/products/attribute-sets/${attributeSetId}`)
      .then((r) => r.data);
  }

  /**
   * Atribui um atributo a um attribute set.
   * POST /rest/V1/products/attribute-sets/attributes
   */
  async atribuirAtributoAoSet(
    attributeSetId: number,
    attributeGroupId: number,
    attributeCode: string,
    sortOrder?: number,
  ): Promise<any> {
    return magentoApi
      .post("/products/attribute-sets/attributes", {
        attributeSetId,
        attributeGroupId,
        attributeCode,
        sortOrder: sortOrder ?? 0,
      })
      .then((r) => r.data);
  }

  /**
   * Remove um atributo de um attribute set.
   * DELETE /rest/V1/products/attribute-sets/:attributeSetId/attributes/:attributeCode
   */
  async removerAtributoDoSet(
    attributeSetId: number,
    attributeCode: string,
  ): Promise<any> {
    return magentoApi
      .delete(
        `/products/attribute-sets/${attributeSetId}/attributes/${encodeURIComponent(attributeCode)}`,
      )
      .then((r) => r.data);
  }

 
}

export default new MagentoProductAttributes();