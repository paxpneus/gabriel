import { jadlogApi, jadlogTrackingApi, jadlogPickupApi, getJadlogToken, JADLOG_QRCODE_URL } from "../../api/jadlog_api.service";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JadlogAddress {
  nome: string;
  cnpjCpf: string;
  ie?: string | null;
  endereco: string;
  numero: string;
  compl?: string | null;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  fone?: string | null;
  cel?: string | null;
  email?: string | null;
  contato?: string | null;
}

export interface JadlogVolume {
  altura: number;
  comprimento: number;
  identificador: string;
  largura: number;
  peso: number;
}

export interface JadlogDfe {
  cfop: string;
  danfeCte: string;
  nrDoc: string;
  serie: string;
  tpDocumento: number;
  valor: number;
}

export interface JadlogIncluirPedidoPayload {
  codCliente: string;
  conteudo: string;
  pedido: string[];
  totPeso: number;
  totValor: number;
  obs?: string | null;
  modalidade: number;
  contaCorrente?: string | null;
  tpColeta: string;
  tipoFrete: number;
  cdUnidadeOri?: string | null;
  cdUnidadeDes?: string | null;
  cdPickupOri?: string | null;
  cdPickupDes?: string | null;
  nrContrato?: number | null;
  servico?: number | null;
  shipmentId?: string | null;
  vlColeta?: number | null;
  rem: JadlogAddress;
  des: JadlogAddress;
  tomador?: JadlogAddress | null;
  exp?: JadlogAddress | null;
  dfe: JadlogDfe[];
  volume: JadlogVolume[];
}

export interface JadlogTrackingFilter {
  codigo?: string;
  shipmentId?: string;
  cte?: string;
  pedido?: string;
  df?: {
    danfe?: string;
    nf?: string;
    serie?: string;
    tpDocumento: number; // 0=Declaracao; 1=NF; 2=NFE; 4=CTE
    cnpjRemetente?: string;
  };
}

export interface JadlogSimularFreteItem {
  cepori: string;
  cepdes: string;
  frap?: string | null;
  peso: number;
  cnpj: string;
  conta?: string | null;
  contrato?: string | null;
  modalidade: number;
  tpentrega: "D" | "R"; // D=Domicilio; R=Retira
  tpseguro: "N" | "A";  // N=Normal; A=Apolice
  vldeclarado: number;
  vlcoleta?: number | null;
}

export interface JadlogTratativaPayload {
  pedido: string;
  usuario: string;
  acareacao: boolean;
  observacao: string;
  finalizar: "S" | "N";
}

export type JadlogPickupTipo = "LOCKER" | "PUBLICO" | "JADLOG";

// ─────────────────────────────────────────────────────────────────────────────
// Service
// ─────────────────────────────────────────────────────────────────────────────

export class JadlogService {

  // ══════════════════════════════════════════════════════════════════════════
  // PEDIDOS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Inclusão de Pedido.
   * POST /pedido/incluir
   */
  async incluirPedido(payload: JadlogIncluirPedidoPayload): Promise<any> {
    return jadlogApi.post("/pedido/incluir", payload).then((r) => r.data);
  }

  /**
   * Cancelamento de Pedido.
   * POST /pedido/cancelar
   * Aceita { shipmentId } ou { codigo }
   */
  async cancelarPedido(payload: { shipmentId?: string; codigo?: string }): Promise<any> {
    return jadlogApi.post("/pedido/cancelar", payload).then((r) => r.data);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // TRACKING
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Consulta de Tracking completo — retorna todos os eventos.
   * Até 100 consultas por chamada.
   * POST /tracking/consultar
   */
  async consultarTracking(consulta: JadlogTrackingFilter[]): Promise<any> {
    return jadlogTrackingApi
      .post("/tracking/consultar", { consulta })
      .then((r) => r.data);
  }

  /**
   * Consulta de Tracking simples — retorna apenas o último status.
   * Até 500 consultas por chamada.
   * POST /tracking/simples/consultar
   */
  async consultarTrackingSimples(consulta: JadlogTrackingFilter[]): Promise<any> {
    return jadlogTrackingApi
      .post("/tracking/simples/consultar", { consulta })
      .then((r) => r.data);
  }

  /**
   * Inclusão de Tratativa em tempo real.
   * Requer conta corrente cadastrada junto ao comercial Jadlog.
   * POST /tracking/incluir_tratativa
   */
  async incluirTratativa(payload: JadlogTratativaPayload): Promise<any> {
    return jadlogApi
      .post("/tracking/incluir_tratativa", payload)
      .then((r) => r.data);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // FRETE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Simulação de Frete.
   * Até 3 simulações por chamada.
   * POST /frete/valor
   */
  async simularFrete(frete: JadlogSimularFreteItem[]): Promise<any> {
    return jadlogApi.post("/frete/valor", { frete }).then((r) => r.data);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CT-e / DACTE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Consulta XML do DACTE (CT-e).
   * Retorna application/xml — se não localizado, retorna null.
   * POST /cte/xml
   */
  async consultarXmlDacte(dacte: string): Promise<string | null> {
    return jadlogApi
      .post<string>("/cte/xml", { dacte }, { responseType: "text" })
      .then((r) => r.data ?? null);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // PICKUP POINTS / PUDOs
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Consulta Pickup Points por CEP.
   * Retorna até 10 pontos em um raio de 10 km do CEP informado.
   * GET /address/pudos/location?tipos=...&cep=...
   *
   * @param tipos - Um ou mais tipos separados por vírgula: "LOCKER,PUBLICO,JADLOG"
   * @param cep   - Ex: "02031-100" ou "02031100"
   */
  async consultarPickupPorCep(
    tipos: JadlogPickupTipo | JadlogPickupTipo[],
    cep: string,
  ): Promise<any> {
    const tiposParam = Array.isArray(tipos) ? tipos.join(",") : tipos;
    return jadlogPickupApi
      .get("/address/pudos/location", { params: { tipos: tiposParam, cep } })
      .then((r) => r.data);
  }

  /**
   * Consulta todos os Pickup Points sem filtro de CEP.
   * GET /address/pudos?tipos=...
   */
  async consultarTodosPickups(
    tipos: JadlogPickupTipo | JadlogPickupTipo[],
  ): Promise<any> {
    const tiposParam = Array.isArray(tipos) ? tipos.join(",") : tipos;
    return jadlogPickupApi
      .get("/address/pudos", { params: { tipos: tiposParam } })
      .then((r) => r.data);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // QRCODE
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Recupera o QRCode (base64) de uma remessa para Pickup Dropoff.
   * Requer negociação prévia com o time de Pickup da Jadlog.
   * GET https://www.jadlog.com.br/qrcodeservice/api/{shipmentId}
   */
  async getQrCode(shipmentId: string): Promise<string> {
    const configToken = await getJadlogToken();

    const response = await fetch(`${JADLOG_QRCODE_URL}/${shipmentId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${configToken.access_token}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `[JadlogService] QRCode falhou: ${response.status} ${response.statusText}`,
      );
    }

    return response.text(); // base64
  }
}

export default new JadlogService();