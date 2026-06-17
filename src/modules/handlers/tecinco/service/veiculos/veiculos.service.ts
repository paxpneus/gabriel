import { tcarRequest } from "../../api/tecinco_api";

export interface TCarVeiculoListParams {
  placa?: string;
  chassi?: string;
  cliente_codigo?: number | string;
  alterado_desde?: string;
  offset?: number;
  limit?: number;
  page_size?: number;
}

export class TCarVeiculoService {
  /**
   * Lista veículos com filtros opcionais.
   * GET /veiculos
   */
  async listarVeiculos(branchId: number, params: TCarVeiculoListParams = {}): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/veiculos", { params }).then((r) => r.data),
    );
  }

  /**
   * Obtém um veículo pelo chassi.
   * GET /veiculos/:chassi
   */
  async obterVeiculo(branchId: number, chassi: string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/veiculos/${encodeURIComponent(chassi)}`).then((r) => r.data),
    );
  }
}

export default TCarVeiculoService;