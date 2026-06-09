import { tcarRequest } from "../../../api/tecinco_api";

export interface TCarDocumentoFinanceiroParams {
  cliente_id?: number;
  tipo_titulo?: string;
  titulo_codigo?: string;
  tipo_despesa?: number;
  numero_boleto?: string;
  numero_ro?: number;
  tipo_documento_cobranca_id?: number;
  status_processo?: number;
  portador?: number;
  grupo_economico?: number;
  razao_fantasia?: string;
  observacao?: string;
  data_emissao_inicial?: string;
  data_emissao_final?: string;
  data_vencimento_inicial?: string;
  data_vencimento_final?: string;
  data_movimento_inicial?: string;
  data_movimento_final?: string;
  data_baixa_inicio?: string;
  data_baixa_final?: string;
  valor_inicial?: number;
  valor_final?: number;
  saldo_inicial?: number;
  saldo_final?: number;
  situacao?: "pago" | "em_aberto" | "cancelado" | "todos";
  pagar_receber?: "pagar" | "receber" | "todos";
  ordenar_por?: "emissao" | "vencimento";
  nota_fiscal?: number;
  pre_nota?: number;
  ordem_servico?: number;
  linha_leitor?: string;
  banco?: string;
  agencia?: string;
  conta?: string;
  numero_cheque?: string;
  vencimento_cheque?: string;
  correntista_codigo?: number;
  correntista_nome?: string;
  correntista_inscricao?: string;
  correntista_identidade?: string;
  correntista_telefone?: string;
}

export class TCarFinanceiroService {
  /**
   * Consulta documentos financeiros em modo somente leitura.
   * Equivalente funcional à tela FN005F do TCar.
   * GET /financeiro/documentos
   *
   * Atenção: o resultado é limitado aos tipos de documento
   * permitidos para o usuário autenticado na sessão.
   */
  async listarDocumentos(branchId: number, params: TCarDocumentoFinanceiroParams = {}): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/financeiro/documentos", { params }).then((r) => r.data),
    );
  }
}

export default TCarFinanceiroService;