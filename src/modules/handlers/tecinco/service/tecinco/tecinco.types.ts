// ─── TeCinco Webhook Event Types ─────────────────────────────────────────────

export type TCarResource =
  | 'product'
  | 'invoice_xml'
  | 'customer';

export type TCarAction = 'created' | 'updated' | 'deleted' | 'sync';

export interface TCarWebhookEnvelope {
  eventId: string;
  date: string; // ISO 8601
  version?: string;
  event: string; // e.g. "product.updated"
  companyId: string;
  branchId?: number;
  data: unknown;
}

// ─── TeCinco API Payloads ─────────────────────────────────────────────────────

/**
 * Payload retornado por GET /produtos
 * Cada item dentro de data[]
 */
export interface TCarProdutoPayload {
  fll_codigo: number;
  epctb_codigo: string;
  epctb_codigofabrica?: string;
  epctb_nome: string;
  epctb_coded?: string;
  epctb_ean?: string;
  epgru_id?: number;
  epsgr_id?: number;
  epapl_id?: string;
  epctb_unidade?: string;
  epctb_pesobruto?: number;
  epctb_pesoliq?: number;
  eppdm_codigo?: number;
  epcte_estoque?: number;
  epcte_saiped?: number;
  epcte_saios?: number;
  epcte_reservaproducao?: number;
  epcte_estoquepoderterceiro?: number;
  epcte_estoquebloqueado?: number | null;
  epcte_estoquegarantia?: number | null;
  epcte_estoquedeposito?: number | null;
  epcte_estoquedisponivel?: number | null;
  epcte_custcont?: number;
  epprc_preco?: number;
  epprc_precorevenda?: number;
  marca_descricao?: string;
}

export interface TCarInvoiceXmlPayload {
  numero: number | string;
  entrada_saida?: string;
  cln_codigo: number | string;
  tpneg_codigo: number | string;
  ntz_codigo: number | string;
  opr_codigo: number | string;
  serie: string;
  seq_cancelamento: string;
}

/**
 * Payload retornado por GET /clientes
 * Cada item dentro de data[]
 */
export interface TCarClientePayload {
  cln_codigo: number;
  cln_nome: string;
  cln_fantasia?: string | null;
  cln_fisjur?: 'F' | 'J';
  cln_cpfcnpj?: string;
  cln_inscrg?: string | null;
  cln_dtnascfun?: string | null;
  cep_cep?: string;
  cln_tipologradouro?: string;
  cln_endereco?: string;
  cln_complemento?: string | null;
  cln_numero?: string;
  cln_bairro?: string;
  cdd_codigo?: number;
  uf_estado?: string;
  cln_cxpostal?: string | null;
  cln_fone?: string | null;
  cln_fone2?: string | null;
  cln_fax?: string | null;
  cln_email?: string | null;
  cln_emailsecundario?: string | null;
  cln_emailmarketing?: string | null;
  cln_emailcobranca?: string | null;
  cln_emailenvionfe?: string | null;
  cln_ramo?: string;
  cln_credito?: string;
  cln_sexo?: string;
  cln_cadsimples?: string;
  cln_obscred?: string | null;
  cln_numeroalvara?: string | null;
  cln_retemissqn?: string;
  cln_aceitareceberemail?: string;
  cln_enviosms?: string;
  cln_lgpdvigencia?: string | null;
  cidade_nome?: string;
  estado_nome?: string;
}

// ─── Internal Queue Payloads ──────────────────────────────────────────────────

export interface TCarWebhookQueuePayload {
  eventId: string;
  resource: TCarResource;
  action: TCarAction;
  companyId: string;
  branchId?: number;
  date: string;
  rawData: unknown;
}

// ─── Mapper result types ──────────────────────────────────────────────────────

export interface TCarMappedWebhookResult {
  /** Dados já suficientes para persistir direto */
  directUpsert?: TCarDirectUpsertPayload;
  /** Sinaliza que precisa buscar mais dados na API TeCinco */
  requiresApiFetch?: TCarApiFetchRequest;
}

export type TCarDirectUpsertPayload =
  | { table: 'products'; data: TCarMappedProduct }
  | { table: 'product_configs'; data: TCarMappedProductConfig }
  | { table: 'customers'; data: TCarMappedCustomer }
  | { table: 'delete'; resource: TCarResource; systemId: string };

export interface TCarApiFetchRequest {
  resource: TCarResource;
  /** id/codigo do registro na TeCinco */
  systemId: string;
  action: TCarAction;
  companyId: string;
  branchId?: number;
  /** Dados parciais já conhecidos pelo webhook / payload */
  partialData?: Partial<TCarMappedProduct> | Partial<TCarMappedCustomer>;
}

// ─── Mapped entity shapes (espelham os models) ────────────────────────────────

export interface TCarMappedProduct {
  /** epctb_codigo — chave no sistema TeCinco */
  id_system: string;
  name: string;
  ean?: string;
  unit?: string;
  gross_weight?: number;
  net_weight?: number;
  source_payload?: Record<string, unknown>;
}

export interface TCarMappedProductConfig {
  /** id_system do produto (para resolver product_id via lookup) */
  productSystemId: string;
  unit_business_id: string;
  sku?: string;
  price?: number;
  supplier_cost_price?: number;
  average_cost?: number;
}

export interface TCarMappedCustomer {
  /** cln_codigo como string */
  id_system?: string;
  name: string;
  type: 'F' | 'J';
  document?: string;
}

export interface TCarNotaFiscalItem {
  epeit_seq: number;
  epctb_codigo: string;
  produto_nome: string;
  produto_unidade: string;
  epeit_qtdade: number;
  epeit_vlrunit: number;
  epeit_vlrdesc?: number;
  epeit_vlrliquido?: number;
  ntz_codigoproduto?: number;
}