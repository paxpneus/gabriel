import { tcarRequest } from "../../../api/tecinco_api";

export class TCarOrcamentoService {
  /**
   * Lista orçamentos com filtros opcionais.
   * GET /orcamentos
   * Nota: este endpoint não suporta alterado_desde (tabela sem DTAALT).
   */
  async listarOrcamentos(
    branchId: number,
    params: {
      cliente_id?: number | string;
      status?: string;
      data_emissao_inicio?: string;
      data_emissao_fim?: string;
      page?: number;
      page_size?: number;
    } = {},
  ): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/orcamentos", { params }).then((r) => r.data),
    );
  }

  /**
   * Obtém um orçamento pelo número.
   * GET /orcamentos/:numero
   */
  async obterOrcamento(branchId: number, numero: number | string): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get(`/orcamentos/${encodeURIComponent(numero)}`).then((r) => r.data),
    );
  }
}

export default TCarOrcamentoService;