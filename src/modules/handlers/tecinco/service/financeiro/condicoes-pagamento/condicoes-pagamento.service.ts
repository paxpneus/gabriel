import { tcarRequest } from "../../../api/tecinco_api";

export class TCarCondicaoPagamentoService {
  /**
   * Lista condições de pagamento.
   * GET /condicoes-pagamento
   */
  async listarCondicoes(
    branchId: number,
    params: { alterado_desde?: string; ativo?: boolean } = {},
  ): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/condicoes-pagamento", { params }).then((r) => r.data),
    );
  }

  /**
   * Obtém uma condição de pagamento pelo código.
   * GET /condicoes-pagamento/:codigo
   */
  async obterCondicao(branchId: number, codigo: number | string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/condicoes-pagamento/${encodeURIComponent(codigo)}`).then((r) => r.data),
    );
  }
}

export default TCarCondicaoPagamentoService;