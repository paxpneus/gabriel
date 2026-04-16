// ─── Bling Webhook Event Types ────────────────────────────────────────────────

export type BlingResource =
  | 'order'
  | 'product'
  | 'stock'
  | 'virtual_stock'
  | 'invoice'
  | 'consumer_invoice'
  | 'product_supplier';

export type BlingAction = 'created' | 'updated' | 'deleted';

export interface BlingWebhookEnvelope {
  eventId: string;
  date: string; // ISO 8601
  version: string;
  event: string; // e.g. "product.updated"
  companyId: string;
  data: unknown;
}

// ─── Bling Payloads ───────────────────────────────────────────────────────────

export interface BlingOrderPayload {
  id: number;
  data?: string;
  numero?: number;
  numeroLoja?: string;
  total?: number;
  contato?: { id: number };
  vendedor?: { id: number };
  loja?: { id: number };
  situacao?: { id: number; valor: number };
}

export interface BlingProductPayload {
  id: number;
  nome?: string;
  codigo?: string;
  tipo?: string;
  situacao?: string;
  preco?: number;
  unidade?: string;
  formato?: string;
  idProdutoPai?: number;
  categoria?: { id: number };
  descricaoCurta?: string;
  descricaoComplementar?: string;
}

export interface BlingStockDepositPayload {
  id: number;
  saldoFisico: number;
  saldoVirtual: number;
}

export interface BlingStockPayload {
  produto: { id: number };
  deposito: BlingStockDepositPayload;
  operacao?: string;
  quantidade?: number;
  saldoFisicoTotal: number;
  saldoVirtualTotal: number;
}

export interface BlingVirtualStockDeposit {
  id: number;
  saldoFisico: number;
  saldoVirtual: number;
}

export interface BlingVirtualStockPayload {
  produto: { id: number };
  saldoFisicoTotal: number;
  saldoVirtualTotal: number;
  vinculoComplexo?: boolean;
  depositos?: BlingVirtualStockDeposit[];
}

export interface BlingInvoicePayload {
  id: number;
  tipo?: number;
  situacao?: number;
  numero?: string;
  dataEmissao?: string;
  dataOperacao?: string;
  contato?: { id: number };
  naturezaOperacao?: { id: number };
  loja?: { id: number };
}

export interface BlingProductSupplierPayload {
  id: number;
  descricao?: string;
  codigo?: string;
  precoCusto?: number;
  precoCompra?: number;
  padrao?: boolean;
  garantia?: number;
  produto?: { id: number };
  fornecedor?: { id: number };
}

// ─── Internal Queue Payloads ──────────────────────────────────────────────────

export interface WebhookQueuePayload {
  eventId: string;
  resource: BlingResource;
  action: BlingAction;
  companyId: string;
  date: string;
  rawData: unknown;
}

// ─── Mapper result types ──────────────────────────────────────────────────────

/**
 * Resultado do mapeamento. Pode ter dados diretos para upsert
 * e/ou sinalizar que precisa de uma req adicional na Bling.
 */
export interface MappedWebhookResult {
  /** Dados já suficientes para persistir direto */
  directUpsert?: DirectUpsertPayload;
  /** Sinaliza que precisa buscar mais dados na API Bling */
  requiresApiFetch?: ApiFetchRequest;
}

export type DirectUpsertPayload =
  | { table: 'products'; data: MappedProduct }
  | { table: 'stocks'; data: MappedStock }
  | { table: 'suppliers'; data: MappedSupplier }
  | { table: 'product_supplier_maps'; data: MappedSupplierMapping }
  | { table: 'delete'; resource: BlingResource; blingId: number };

export interface ApiFetchRequest {
  resource: BlingResource;
  blingId: number;
  action: BlingAction;
  companyId: string;
  /** Dados parciais já conhecidos pelo webhook */
  partialData?: Partial<MappedInvoice>;
}

// ─── Mapped entity shapes (espelham os models) ────────────────────────────────

export interface MappedProduct {
  /** blingId como referência externa — seu sistema usa UUID interno */
  blingId: number;
  name: string;
  sku: string;
  /** EAN não vem no webhook; será preenchido via req adicional */
  ean?: string;
}

export interface MappedStock {
  /** blingId do produto — necessário para resolver o product_id UUID */
  productBlingId: number;
  /** saldoFisicoTotal do deposito */
  quantity: number;
}

export interface MappedInvoice {
  blingId: number;
  type: 'INCOMING' | 'OUTGOING';
  status: 'OPEN' | 'PENDING' | 'FINISHED' | 'CANCELLED';
  /** id_system = id do Bling como string */
  id_system: string;
  /** Campos extras precisam de req na Bling */
  customer_name?: string;
  customer_document?: string;
  key?: string;
  sender_cnpj?: string;
  sender_name?: string;
  receiver_cnpj?: string;
  receiver_name?: string;
}

export interface MappedSupplierMapping {
  productBlingId: number;
  supplierBlingId: number;
  supplier_product_code: string;
}

export interface MappedSupplier {
  id_system: string;
  name: string;
  document: string;
  fantasy_name?: string | null;
  city: string;
  uf: string;
  codigo?: string;
}