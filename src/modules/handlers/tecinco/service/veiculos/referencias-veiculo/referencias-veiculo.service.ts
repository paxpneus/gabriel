import { tcarRequest } from "../../../api/tecinco_api";

export class TCarReferenciaVeiculoService {
  // ─── Marcas ────────────────────────────────────────────────────────────────

  /**
   * Lista todas as marcas de veículos.
   * GET /marcas-veiculos
   */
  async listarMarcas(branchId: number): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/marcas-veiculos").then((r) => r.data),
    );
  }

  /**
   * Obtém uma marca pelo código.
   * GET /marcas-veiculos/:codigo
   */
  async obterMarca(branchId: number, codigo: number | string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/marcas-veiculos/${encodeURIComponent(codigo)}`).then((r) => r.data),
    );
  }

  // ─── Modelos ───────────────────────────────────────────────────────────────

  /**
   * Lista modelos de veículos com filtros opcionais.
   * GET /modelos-veiculos
   */
  async listarModelos(
    branchId: number,
    params: { marca_codigo?: number | string; alterado_desde?: string } = {},
  ): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/modelos-veiculos", { params }).then((r) => r.data),
    );
  }

  /**
   * Obtém um modelo pelo ID.
   * GET /modelos-veiculos/:id
   */
  async obterModelo(branchId: number, id: number | string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/modelos-veiculos/${encodeURIComponent(id)}`).then((r) => r.data),
    );
  }

  // ─── Cores ─────────────────────────────────────────────────────────────────

  /**
   * Lista todas as cores de veículos.
   * GET /cores-veiculos
   */
  async listarCores(branchId: number, params: { alterado_desde?: string } = {}): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/cores-veiculos", { params }).then((r) => r.data),
    );
  }

  /**
   * Obtém uma cor pelo ID.
   * GET /cores-veiculos/:id
   */
  async obterCor(branchId: number, id: number | string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/cores-veiculos/${encodeURIComponent(id)}`).then((r) => r.data),
    );
  }

  // ─── Combustíveis ──────────────────────────────────────────────────────────

  /**
   * Lista todos os combustíveis de veículos.
   * GET /combustiveis-veiculos
   */
  async listarCombustiveis(branchId: number, params: { alterado_desde?: string } = {}): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/combustiveis-veiculos", { params }).then((r) => r.data),
    );
  }

  /**
   * Obtém um combustível pelo ID.
   * GET /combustiveis-veiculos/:id
   */
  async obterCombustivel(branchId: number, id: number | string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/combustiveis-veiculos/${encodeURIComponent(id)}`).then((r) => r.data),
    );
  }
}

export default TCarReferenciaVeiculoService;