export enum PdvSalesRequestStatus {
  OPEN = "OPEN",
  PENDING_FINANCE = "PENDING_FINANCE",
  PENDING_CD21_ANALYSIS = "PENDING_CD21_ANALYSIS",
  PENDING_CORRECTION = "PENDING_CORRECTION",
  PENDING_NF_SALE = "PENDING_NF_SALE",
  PENDING_NF_TRANSFER = "PENDING_NF_TRANSFER",
  SHIPPING = "SHIPPING",
  FINISHED = "FINISHED",
  CANCELLED = "CANCELLED",
  // Nota de venda ou de transferência vinculada foi cancelada pela Bling/
  // Tecinco (ver PdvSalesRequestService.handleInvoiceCancelled) — bloqueia
  // o fluxo até uma ação humana decidir reabrir ou criar nova solicitação.
  INVOICE_CANCELLED = "INVOICE_CANCELLED",
}

// Status que encerram o ciclo de vida da solicitação — usado tanto pra saber
// se já existe uma solicitação ATIVA pro pedido (createRequest) quanto pra
// filtrar quais solicitações handleInvoiceCancelled ainda deve tocar.
export const TERMINAL_PDV_SALES_REQUEST_STATUSES: readonly PdvSalesRequestStatus[] =
  [
    PdvSalesRequestStatus.FINISHED,
    PdvSalesRequestStatus.CANCELLED,
    PdvSalesRequestStatus.INVOICE_CANCELLED,
  ];

export enum PdvShippingType {
  TRANSPORTADORA = "TRANSPORTADORA",
  ADT = "ADT",
}

export enum PdvCorrectionOrigin {
  FINANCE = "FINANCE",
  CD21_ANALYSIS = "CD21_ANALYSIS",
  EXPEDITION = "EXPEDITION",
  // CD21 decidiu devolver pra loja em vez de reenviar direto pra reanálise,
  // depois de handleInvoiceCancelled — ver cd21ResolveInvoiceCancelled.
  INVOICE_CANCELLED = "INVOICE_CANCELLED",
  // CD21 reabriu uma solicitação já FINISHED pra correção — ver
  // correctFinishedRequest.
  FINISHED = "FINISHED",
}

export enum PdvCorrectionReason {
  PAYMENT_RECEIPT = "PAYMENT_RECEIPT",
  CUSTOMER_NAME = "CUSTOMER_NAME",
  CUSTOMER_DOCUMENT = "CUSTOMER_DOCUMENT",
  PAYMENT_METHOD = "PAYMENT_METHOD",
  INSTALLMENTS = "INSTALLMENTS",
  SHIPPING_TYPE = "SHIPPING_TYPE",
  ORDER_NUMBER = "ORDER_NUMBER",
  ORDER_DATE = "ORDER_DATE",
  TOTAL_VALUE = "TOTAL_VALUE",
  DISCOUNT_VALUE = "DISCOUNT_VALUE",
  BLING_PDF = "BLING_PDF",
  OTHER_INFO = "OTHER_INFO",
  PRODUCT_UNAVAILABLE = "PRODUCT_UNAVAILABLE",
  ITEM_DIVERGENCE = "ITEM_DIVERGENCE",
  DAMAGED_PRODUCT = "DAMAGED_PRODUCT",
  INVOICE_CANCELLED = "INVOICE_CANCELLED",
}

export const CORRECTION_REASONS_BY_ORIGIN: Record<
  PdvCorrectionOrigin,
  PdvCorrectionReason[]
> = {
  [PdvCorrectionOrigin.FINANCE]: [PdvCorrectionReason.PAYMENT_RECEIPT],
  [PdvCorrectionOrigin.CD21_ANALYSIS]: [
    PdvCorrectionReason.CUSTOMER_NAME,
    PdvCorrectionReason.CUSTOMER_DOCUMENT,
    PdvCorrectionReason.PAYMENT_METHOD,
    PdvCorrectionReason.INSTALLMENTS,
    PdvCorrectionReason.SHIPPING_TYPE,
    PdvCorrectionReason.ORDER_NUMBER,
    PdvCorrectionReason.ORDER_DATE,
    PdvCorrectionReason.TOTAL_VALUE,
    PdvCorrectionReason.DISCOUNT_VALUE,
    PdvCorrectionReason.BLING_PDF,
    PdvCorrectionReason.PAYMENT_RECEIPT,
    PdvCorrectionReason.OTHER_INFO,
  ],
  [PdvCorrectionOrigin.EXPEDITION]: [
    PdvCorrectionReason.PRODUCT_UNAVAILABLE,
    PdvCorrectionReason.ITEM_DIVERGENCE,
    PdvCorrectionReason.DAMAGED_PRODUCT,
    PdvCorrectionReason.OTHER_INFO,
  ],
  [PdvCorrectionOrigin.INVOICE_CANCELLED]: [
    PdvCorrectionReason.INVOICE_CANCELLED,
  ],
  [PdvCorrectionOrigin.FINISHED]: [
    PdvCorrectionReason.PRODUCT_UNAVAILABLE,
    PdvCorrectionReason.ITEM_DIVERGENCE,
    PdvCorrectionReason.DAMAGED_PRODUCT,
    PdvCorrectionReason.OTHER_INFO,
  ],
};

export interface PdvSalesRequestErrors {
  origin: PdvCorrectionOrigin;
  reasons: PdvCorrectionReason[];
  note: string;
}

export type PaymentReceiptType =
  | "cartao_credito"
  | "cartao_debito"
  | "pix"
  | "transferencia";

// Schema fixo do que o Gemini deve extrair do comprovante — nunca um JSON
// solto/genérico. Todo campo é nullable: o prompt instrui a IA a devolver
// null pra qualquer campo ilegível/coberto/rasurado em vez de inventar.
export interface PaymentReceiptExtraction {
  tipo_comprovante: PaymentReceiptType | null;
  estabelecimento_nome: string | null;
  estabelecimento_cnpj: string | null;
  valor_total: number | null;
  qtd_parcelas: number | null;
  valor_parcela: number | null;
  data_transacao: string | null;
  hora_transacao: string | null;
  bandeira_cartao: string | null;
  // Texto literal do comprovante — banco/instituição (ex.: "Itaú", "Mercado
  // Pago") OU nome/apelido da maquininha (ex.: "Laranjinha Itaú"), que nem
  // sempre bate com o nome "limpo" da instituição.
  instituicao_pagamento: string | null;
  titular_cartao: string | null;
  cartao_final: string | null;
  codigo_autorizacao: string | null;
  nsu_cv: string | null;
}

// Base pra merge de edição manual (updateReceiptAnalysis) quando a análise
// da IA ainda é null (falhou ou nunca rodou) — nunca espalhar esse literal
// em mais de um lugar.
export const EMPTY_PAYMENT_RECEIPT_EXTRACTION: PaymentReceiptExtraction = {
  tipo_comprovante: null,
  estabelecimento_nome: null,
  estabelecimento_cnpj: null,
  valor_total: null,
  qtd_parcelas: null,
  valor_parcela: null,
  data_transacao: null,
  hora_transacao: null,
  bandeira_cartao: null,
  instituicao_pagamento: null,
  titular_cartao: null,
  cartao_final: null,
  codigo_autorizacao: null,
  nsu_cv: null,
};

// Visão CONCILIADA de N comprovantes (um PdvSalesRequestReceipt por
// comprovante, ver sales-request-receipt/) — nunca a extração de um
// comprovante só. Tipo próprio, não PaymentReceiptExtraction:
// tipo_comprovante deixa de ser um enum único (pode ser "pix +
// cartao_credito", ver helpers/receipt-reconciliation.ts) e alguns campos têm
// regra de junção diferente de "pegar o valor". Persistido em
// pdv_sales_requests.payment_receipt_analysis, recalculado a cada
// comprovante adicionado/editado/removido — nunca lido/gravado direto pelos
// endpoints de comprovante individual.
export interface PaymentReceiptReconciledAnalysis {
  tipo_comprovante: string | null;
  estabelecimento_nome: string | null;
  estabelecimento_cnpj: string | null;
  valor_total: number | null;
  qtd_parcelas: number | null;
  valor_parcela: number | null;
  data_transacao: string | null;
  hora_transacao: string | null;
  bandeira_cartao: string | null;
  instituicao_pagamento: string | null;
  titular_cartao: string | null;
  cartao_final: string | null;
  codigo_autorizacao: string | null;
  nsu_cv: string | null;
}

export interface PdvSalesRequestAttributes {
  id: string;
  order_id: string;
  // Espelhado de order.unit_business_id na criação, nunca setado via API —
  // usado pela Etapa 2 (token de link) pra resolver/filtrar a filial sem
  // precisar buscar a order de novo.
  unit_business_id: string | null;
  sale_invoice_id: string | null;
  transfer_invoice_id: string | null;
  status: PdvSalesRequestStatus;
  correction_origin_status: PdvSalesRequestStatus | null;
  shipping_type: PdvShippingType | null;
  name: string;
  // Conciliação de todos os PdvSalesRequestReceipt anexados no momento — ver
  // PaymentReceiptReconciledAnalysis. null enquanto não há nenhum comprovante
  // com análise ainda.
  payment_receipt_analysis: PaymentReceiptReconciledAnalysis | null;
  payment_receipt_validated: boolean | null;
  // Só calculado com exatamente 1 comprovante anexado — com 2+, os tipos
  // podem divergir entre si (ex.: PIX + cartão) e a comparação 1:1 contra
  // order.paymentMethod não faz mais sentido; financeiro revisa manualmente.
  payment_method_matches_receipt: boolean | null;
  // Informativo, nunca bloqueia nenhuma transição — payment_receipt_analysis
  // (conciliado).valor_total x order.total_order. null quando não dá pra
  // comparar (nenhum comprovante com valor ainda, ou pedido sem total).
  receipt_total_matches_order: boolean | null;
  errors: PdvSalesRequestErrors | null;
  created_by_user_id: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PdvSalesRequestCreationAttributes = Omit<
  PdvSalesRequestAttributes,
  "id" | "createdAt" | "updatedAt"
>;

// ─── Pedido (Bling) embutido na resposta ────────────────────────────────────
// Nunca persistido nesta tabela — resolvido on-the-fly, ver "Card do Kanban"
// em .claude/entities/pdv-sales-request/index.md.

export interface PdvSalesRequestOrderCustomer {
  id: string;
  name: string;
  document: string;
}

export interface PdvSalesRequestOrderUnitBusiness {
  id: string;
  number: string;
  name: string;
}

// Loja da PRÓPRIA PdvSalesRequest (association own unit_business_id),
// distinta de PdvSalesRequestOrderUnitBusiness (loja do order aninhado) —
// versão enxuta, id+number apenas, embutida no topo da resposta.
export interface PdvSalesRequestUnitBusiness {
  id: string;
  number: string;
}

// saleInvoice/transferInvoice (associações own sale_invoice_id/
// transfer_invoice_id), embutidas no topo da resposta — front usa
// number_system pra exibir e id pra montar GET /:id/invoice/:invoiceId/danfe.
export interface PdvSalesRequestInvoiceSummary {
  id: string;
  number_system: string;
}

// `receipts` (sibling de order/unitBusiness/saleInvoice/transferInvoice),
// embutido no topo da resposta — um item por PdvSalesRequestReceipt
// anexado. `analysis` aqui é a extração CRUA desse comprovante específico
// (PaymentReceiptExtraction), nunca a conciliada (essa fica em
// payment_receipt_analysis, no topo da própria PdvSalesRequest).
export interface PdvSalesRequestReceiptSummary {
  id: string;
  path: string;
  analysis: PaymentReceiptExtraction | null;
  validated: boolean | null;
  createdAt: Date;
}

export interface PdvSalesRequestOrderPaymentMethod {
  id: string;
  description: string;
}

export interface PdvSalesRequestOrderItem {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  price: number;
}

// Versão leve, usada na listagem (index) — sem forma de pagamento/parcelas/
// itens, que só a tela de detalhe (show) precisa.
export interface PdvSalesRequestOrderSummary {
  id: string;
  number_order_channel: string;
  number_order_system: string | null;
  date: string | null;
  total_order: number | null;
  customer: PdvSalesRequestOrderCustomer | null;
  unitBusiness: PdvSalesRequestOrderUnitBusiness | null;
}

// Versão completa, usada no detalhe (show). `installments` deriva de
// `order.source_payload.parcelas.length` — não é coluna própria.
export interface PdvSalesRequestOrderDetail extends PdvSalesRequestOrderSummary {
  paymentMethod: PdvSalesRequestOrderPaymentMethod | null;
  installments: number | null;
  items: PdvSalesRequestOrderItem[];
}
