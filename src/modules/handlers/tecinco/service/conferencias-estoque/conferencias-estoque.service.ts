import { tcarRequest } from "../../api/tecinco_api";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

export type TCarConferenciaTipo = "nota-fiscal" | "pre-nota" | "ordem-servico";

/**
 * Parâmetros obrigatórios adicionais para documentos do tipo nota-fiscal.
 * Devem ser passados como query string junto ao tipo/número.
 */
export interface TCarNotaFiscalQueryParams {
  CLN_CODIGO: number | string;
  TPNEG_CODIGO: number | string;
  NTZ_CODIGO: number | string;
  OPR_CODIGO: number | string;
  EPENF_SERIE: number | string;
}

export interface TCarConferenciaListParams {
  tipo?: TCarConferenciaTipo;
  status_conferencia?: string;
  offset?: number;
  limit?: number;
  page_size?: number;
}

export interface TCarValidarItemBody {
  /** Código do produto ou EAN. */
  codigo_produto: string;
  /**
   * Sequência do item no documento.
   * Pode ser omitida ou 0 quando o produto aparece uma única vez.
   */
  sequencia?: number;
}

export interface TCarConferirItemBody {
  seq: number;
  produto_codigo: string;
  qtde_conferida: number;
}

export interface TCarConferirBody {
  /** ID do usuário responsável pela conferência. */
  usuario_id?: string;
  itens: TCarConferirItemBody[];
}

export interface TCarAutoConferirBody {
  /** ID do usuário responsável pela conferência automática. */
  usuario_id?: number;
}

export interface TCarNotaFiscalXmlByChaveNfe {
  chave_nfe: string;
}

export interface TCarNotaFiscalXmlByChaveComposta {
  tpneg_codigo: number | string;
  ntz_codigo: number | string;
  opr_codigo: number | string;
  cln_codigo: number | string;
  serie: string;
  seq_cancelamento: string;
}

export type TCarNotaFiscalXmlParams =
  | TCarNotaFiscalXmlByChaveNfe
  | TCarNotaFiscalXmlByChaveComposta;

export interface TCarNotaFiscalListParams {
  nota?: number | string;
  entrada_saida?: "E" | "S";
  situacao?: "A" | "N" | "C";
  modelo_documento?: number;
  cliente_id?: number;
  data_movimento_inicio?: string;
  data_movimento_fim?: string;
  limit?: number;
  offset?: number;
}
// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class TCarConferenciaEstoqueService {
  /**
   * Constrói os query params mesclando os params básicos com os extra
   * obrigatórios para nota-fiscal.
   */
  private buildParams(
    tipo: TCarConferenciaTipo,
    extraParams: Partial<TCarNotaFiscalQueryParams> = {},
    baseParams: Record<string, any> = {},
  ): Record<string, any> {
    if (tipo === "nota-fiscal") {
      const required: Array<keyof TCarNotaFiscalQueryParams> = [
        "CLN_CODIGO",
        "TPNEG_CODIGO",
        "NTZ_CODIGO",
        "OPR_CODIGO",
        "EPENF_SERIE",
      ];
      for (const key of required) {
        if (extraParams[key] === undefined || extraParams[key] === null) {
          throw new Error(
            `[TCarConferenciaEstoqueService] Parâmetro obrigatório ausente para nota-fiscal: ${key}`,
          );
        }
      }
      return { ...baseParams, ...extraParams };
    }
    return baseParams;
  }

  // ─── GET /conferencias-estoque ─────────────────────────────────────────────

  /**
   * Retorna o XML original de uma nota fiscal.
   * GET /notas-fiscais/:nota/xml
   *
   * Identificação por chave NFe: passe { chave_nfe }
   * Identificação por chave composta: passe { tpneg_codigo, ntz_codigo, opr_codigo, cln_codigo, serie, seq_cancelamento }
   */
  async buscarXmlNotaFiscal(
    branchId: number,
    nota: number | string,
    identificacao: TCarNotaFiscalXmlParams,
  ): Promise<string> {
    return tcarRequest(branchId, (api) =>
      api
        .get(`/notas-fiscais/${encodeURIComponent(nota)}/xml`, {
          params: identificacao,
          responseType: "text",
        })
        .then((r) => r.data),
    );
  }

  async listarNotasFiscais(
    branchId: number,
    params: TCarNotaFiscalListParams = {},
  ): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/notas-fiscais", { params }).then((r) => r.data),
    );
  }

  async getNotaFiscal(
    nota: number | string,
    branchId: number,
    identificacao: TCarNotaFiscalXmlParams,
  ): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api
        .get(`/notas-fiscais/${encodeURIComponent(nota)}`, {
          params: identificacao,
        })
        .then((r) => r.data),
    );
  }

  /**
   * Lista documentos disponíveis para conferência.
   * GET /conferencias-estoque
   */
  async listarConferencias(
    branchId: number,
    params: TCarConferenciaListParams = {},
  ): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/conferencias-estoque", { params }).then((r) => r.data),
    );
  }

  // ─── GET /conferencias-estoque/config ─────────────────────────────────────

  /**
   * Retorna a configuração de apresentação e status das conferências.
   * GET /conferencias-estoque/config
   */
  async obterConfig(branchId: number): Promise<any> {
    return tcarRequest(branchId, (api) =>
      api.get("/conferencias-estoque/config").then((r) => r.data),
    );
  }

  // ─── GET /conferencias-estoque/:tipo/:numero ───────────────────────────────

  /**
   * Carrega um documento e seus itens para conferência.
   * GET /conferencias-estoque/:tipo/:numero
   *
   * Para tipo "nota-fiscal", passe os campos de chave composta em extraParams.
   */
  async carregarDocumento(
    branchId: number,
    tipo: TCarConferenciaTipo,
    numero: number | string,
    extraParams: Partial<TCarNotaFiscalQueryParams> = {},
  ): Promise<any> {
    const params = this.buildParams(tipo, extraParams);
    return tcarRequest(branchId, (api) =>
      api
        .get(`/conferencias-estoque/${tipo}/${encodeURIComponent(numero)}`, {
          params,
        })
        .then((r) => {
          let raw =
            typeof r.data === "string" ? r.data : JSON.stringify(r.data);
          // Corrige números com vírgula decimal: 80,000 → 80.000
          raw = raw.replace(/:(\s*)(\d+),(\d+)/g, ":$1$2.$3");

          try {
            return JSON.parse(raw);
          } catch (e) {
            console.error(
              "[TCarConferenciaEstoqueService] JSON inválido:",
              raw,
            );
            throw e;
          }
        }),
    );
  }
  // ─── POST /conferencias-estoque/:tipo/:numero/validar-item ─────────────────

  /**
   * Valida produto/EAN, sequência e quantidade antes de conferir.
   * POST /conferencias-estoque/:tipo/:numero/validar-item
   *
   * Para tipo "nota-fiscal", passe os campos de chave composta em extraParams.
   */
  async validarItem(
    branchId: number,
    tipo: TCarConferenciaTipo,
    numero: number | string,
    body: TCarValidarItemBody,
    extraParams: Partial<TCarNotaFiscalQueryParams> = {},
  ): Promise<any> {
    const params = this.buildParams(tipo, extraParams);
    return tcarRequest(branchId, (api) =>
      api
        .post(
          `/conferencias-estoque/${tipo}/${encodeURIComponent(numero)}/validar-item`,
          body,
          { params },
        )
        .then((r) => r.data),
    );
  }

  // ─── POST /conferencias-estoque/:tipo/:numero/conferir ────────────────────

  /**
   * Registra as quantidades conferidas para um ou mais itens.
   * POST /conferencias-estoque/:tipo/:numero/conferir
   *
   * Para tipo "nota-fiscal", passe os campos de chave composta em extraParams.
   */
  async conferir(
    branchId: number,
    tipo: TCarConferenciaTipo,
    numero: number | string,
    body: TCarConferirBody,
    extraParams: Partial<TCarNotaFiscalQueryParams> = {},
  ): Promise<any> {
    const params = this.buildParams(tipo, extraParams);
    console.log("numero:", numero, "branchId:", branchId, "body:", body);
    return tcarRequest(branchId, (api) =>
      api
        .post(
          `/conferencias-estoque/${tipo}/${encodeURIComponent(numero)}/conferir`,
          body,
          { params },
        )
        .then((r) => r.data),
    );
  }

  // ─── POST /conferencias-estoque/:tipo/:numero/auto-conferir ───────────────

  /**
   * Confere automaticamente todos os itens elegíveis do documento.
   * POST /conferencias-estoque/:tipo/:numero/auto-conferir
   *
   * Para tipo "nota-fiscal", passe os campos de chave composta em extraParams.
   */
  async autoConferir(
    branchId: number,
    tipo: TCarConferenciaTipo,
    numero: number | string,
    body: TCarAutoConferirBody = {},
    extraParams: Partial<TCarNotaFiscalQueryParams> = {},
  ): Promise<any> {
    const params = this.buildParams(tipo, extraParams);
    return tcarRequest(branchId, (api) =>
      api
        .post(
          `/conferencias-estoque/${tipo}/${encodeURIComponent(numero)}/auto-conferir`,
          body,
          { params },
        )
        .then((r) => r.data),
    );
  }
}

export default TCarConferenciaEstoqueService;
