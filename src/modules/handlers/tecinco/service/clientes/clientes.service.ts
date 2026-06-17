import { tcarRequest } from "../../api/tecinco_api";

export interface TCarClienteListParams {
  branch_id: number;
  nome?: string;
  cpf_cnpj?: string;
  email?: string;
  alterado_desde?: string;
  offset?: number;
  limit?: number;
  page_size?: number;
}

export class TCarClienteService {
  /**
   * Lista clientes com filtros opcionais.
   * GET /clientes
   */
  async listarClientes(branchId: number, params: Omit<TCarClienteListParams, "branch_id"> = {}): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/clientes", { params }).then((r) => r.data),
    );
  }

  /**
   * Obtém um cliente pelo ID.
   * GET /clientes/:id
   */
  async obterCliente(branchId: number, id: number | string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/clientes/${encodeURIComponent(id)}`).then((r) => r.data),
    );
  }
}

export default TCarClienteService;