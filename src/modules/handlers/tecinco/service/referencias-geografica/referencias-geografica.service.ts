import { tcarRequest } from "../../api/tecinco_api";

export class TCarReferenciaGeograficaService {
  /**
   * Lista todos os estados.
   * GET /estados
   */
  async listarEstados(branchId: number, params: { alterado_desde?: string } = {}): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/estados", { params }).then((r) => r.data),
    );
  }

  /**
   * Obtém um estado pela UF.
   * GET /estados/:uf
   */
  async obterEstado(branchId: number, uf: string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/estados/${encodeURIComponent(uf)}`).then((r) => r.data),
    );
  }

  /**
   * Lista cidades com filtros opcionais.
   * GET /cidades
   */
  async listarCidades(
    branchId: number,
    params: { uf?: string; nome?: string; alterado_desde?: string; limit?: number; offset?: number; page_size?: number } = {},
  ): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/cidades", { params }).then((r) => r.data),
    );
  }

  /**
   * Obtém uma cidade pelo ID.
   * GET /cidades/:id
   */
  async obterCidade(branchId: number, id: number | string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/cidades/${encodeURIComponent(id)}`).then((r) => r.data),
    );
  }
}

export default TCarReferenciaGeograficaService;