import { tcarRequest } from "../../api/tecinco_api";

export interface TCarOrdemServicoListParams {
  situacao?: string;
  data_abertura_inicio?: string;
  data_abertura_fim?: string;
  data_fechamento_inicio?: string;
  data_fechamento_fim?: string;
  cliente?: string | number;
  tipo_os?: string;
  veiculo?: string;
  alterado_desde?: string;
  offset?: number;
  limit?: number;
  page_size?: number;
}

export class TCarOrdemServicoService {
  /**
   * Lista ordens de serviço com detalhes completos (itens, serviços,
   * serviços de terceiros e serviços agregados).
   * GET /ordens-servico
   */
  async listarOrdensServico(branchId: number, params: TCarOrdemServicoListParams = {}): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/ordens-servico", { params }).then((r) => r.data),
    );
  }
}

export default TCarOrdemServicoService;