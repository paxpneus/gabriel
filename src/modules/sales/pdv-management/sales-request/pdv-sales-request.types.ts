import type { PdvColumnAction } from "../helpers/pdv-screens.config";

export enum PdvSalesRequestStatus {
  OPEN = "OPEN",
  PENDING_FINANCE = "PENDING_FINANCE",
  PENDING_CD21_ANALYSIS = "PENDING_CD21_ANALYSIS",
  PENDING_CORRECTION = "PENDING_CORRECTION",
  PENDING_NF_SALE = "PENDING_NF_SALE",
  PENDING_NF_TRANSFER = "PENDING_NF_TRANSFER",
  // Expedição de ADT (aparece como "Pendente expedição" no front).
  SHIPPING = "SHIPPING",
  // Expedição de TRANSPORTADORA — mesmo comportamento de SHIPPING, só outra coluna.
  SHIP_TODAY = "SHIP_TODAY",
  FINISHED = "FINISHED",
  CANCELLED = "CANCELLED",
  // Nota de venda ou de transferência vinculada foi cancelada pela Bling/
  // Tecinco (ver PdvSalesRequestService.handleInvoiceCancelled) — bloqueia
  // o fluxo até uma ação humana decidir reabrir ou criar nova solicitação.
  INVOICE_CANCELLED = "INVOICE_CANCELLED",
  // Destino de deleteRequest — a solicitação nunca é apagada de fato, só
  // zerada (ver PdvSalesRequestService.deleteRequest): mantém sale_invoice_id,
  // limpa o resto, apaga comprovantes e histórico, e cai aqui.
  EXCLUDED = "EXCLUDED",
}

// Status que encerram o ciclo de vida da solicitação — usado tanto pra saber
// se já existe uma solicitação ATIVA pro pedido (createRequest) quanto pra
// filtrar quais solicitações handleInvoiceCancelled ainda deve tocar.
export const TERMINAL_PDV_SALES_REQUEST_STATUSES: readonly PdvSalesRequestStatus[] =
  [
    PdvSalesRequestStatus.FINISHED,
    PdvSalesRequestStatus.CANCELLED,
    PdvSalesRequestStatus.INVOICE_CANCELLED,
    PdvSalesRequestStatus.EXCLUDED,
  ];

// Status de expedição (aguardando romaneio) — SHIPPING (ADT) e SHIP_TODAY
// (TRANSPORTADORA) têm exatamente as mesmas regras, nunca tratar só um.
export const EXPEDITION_PDV_SALES_REQUEST_STATUSES: readonly PdvSalesRequestStatus[] =
  [PdvSalesRequestStatus.SHIPPING, PdvSalesRequestStatus.SHIP_TODAY];

// Transportadora alvo das ações/filtros de lote do PDV: CD próprio (ADT, pelo nome "... - CD <n>") ou transportadora cadastrada (id).
export type PdvTransporterSelector = { cd: string } | { transporterId: string };

// Estágio da nota de venda no lote de saída do CD21 — base dos filtros e das ações de lote do PDV.
export enum PdvBatchStage {
  WITHOUT_BATCH = "WITHOUT_BATCH",
  IN_BATCH = "IN_BATCH",
  OPEN_BATCH = "OPEN_BATCH",
  FINISHED_WITHOUT_DELIVERY_NOTE = "FINISHED_WITHOUT_DELIVERY_NOTE",
}

// Cor hex do card no quadro pela situação do lote da nota de venda (null = sem nota ou fora desses 3 estágios).
export type PdvBatchColor = `#${string}`;

// Solicitação candidata a uma ação de lote do PDV: nota de venda, pedido e transportadora da nota.
export interface PdvBatchTarget {
  id: string;
  sale_invoice_id: string | null;
  order_number: string | null;
  transporter_id: string | null;
  transporter_name: string | null;
}

// Todos opcionais e combinados com AND.
export interface PdvBatchTargetFilter {
  ids?: string[];
  status?: PdvSalesRequestStatus;
  transporter?: PdvTransporterSelector;
  batchStage?: PdvBatchStage;
}

export enum PdvShippingType {
  TRANSPORTADORA = "TRANSPORTADORA",
  ADT = "ADT",
}

// Quem operou a solicitação — gravado uma vez só, no 1º tipo de envio ou 1º comprovante (ver helpers/sales-request-origin.ts).
export enum PdvSalesRequestOrigin {
  TELESALES = "TELEVENDAS",
  STORE = "LOJA",
}

export enum PdvCorrectionOrigin {
  FINANCE = "FINANCE",
  CD21_ANALYSIS = "CD21_ANALYSIS",
  EXPEDITION = "EXPEDITION",
  // CD21 decidiu devolver pra loja em vez de reenviar direto pra reanálise,
  // depois de handleInvoiceCancelled — ver cd21ResolveInvoiceCancelled.
  INVOICE_CANCELLED = "INVOICE_CANCELLED",
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

// Forma de pagamento do catálogo (payment_methods) escolhida/resolvida pro
// comprovante — snapshot id+description pro front exibir sem outro fetch.
export interface PaymentReceiptPaymentMethod {
  id: string;
  description: string;
}

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
  // Não vem da IA direto: resolvido depois da extração (payment-method-match.ts)
  // ou escolhido na edição manual. Opcional pra análises antigas.
  payment_method?: PaymentReceiptPaymentMethod | null;
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
  // União (distinta por id) das formas de pagamento de cada comprovante.
  payment_methods?: PaymentReceiptPaymentMethod[];
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
  shipping_address: string | null;
  transporter_name: string | null;
  origin: PdvSalesRequestOrigin | null;
  name: string;
  // Conciliação de todos os PdvSalesRequestReceipt anexados no momento — ver
  // PaymentReceiptReconciledAnalysis. null enquanto não há nenhum comprovante
  // com análise ainda.
  payment_receipt_analysis: PaymentReceiptReconciledAnalysis | null;
  payment_receipt_validated: boolean | null;
  // Conjunto de formas de pagamento da Bling (order.payments) x conjunto de
  // comprovantes — ver helpers/payment-method-match.ts.
  payment_method_matches_receipt: boolean | null;
  // Informativo, nunca bloqueia nenhuma transição — payment_receipt_analysis
  // (conciliado).valor_total x order.net_total_order. null quando não dá pra
  // comparar (nenhum comprovante com valor ainda, ou pedido sem total).
  receipt_total_matches_order: boolean | null;
  // valor_total conciliado − order.net_total_order: negativo = pago a menos,
  // positivo = pago a mais. Mesmo null de receipt_total_matches_order.
  receipt_total_difference: number | null;
  // Informativo, nunca bloqueia nenhuma transição — compara os product_id e
  // as quantidades totais dos itens da NF de venda e da transferência.
  transfer_invoice_products_match_sale: boolean | null;
  errors: PdvSalesRequestErrors | null;
  created_by_user_id: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PdvSalesRequestCreationAttributes = Omit<
  PdvSalesRequestAttributes,
  "id" | "createdAt" | "updatedAt"
>;

// ─── Pedido (Bling) sem solicitação (/orders/eligible, /orders/:orderId) ─────
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

export interface PdvSalesRequestOrderPaymentMethod {
  id: string;
  description: string;
}

// Parcelas da mesma forma agrupadas (ver toPaymentsView).
export interface PdvSalesRequestOrderPayment {
  paymentMethod: PdvSalesRequestOrderPaymentMethod | null;
  detail: string | null;
  amount: number;
  installments: number;
  first_due_date: string | null;
  last_due_date: string | null;
}

export interface PdvSalesRequestOrderItem {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  price: number;
}

// Versão leve (/orders/eligible) — sem forma de pagamento/parcelas/itens.
export interface PdvSalesRequestOrderSummary {
  id: string;
  number_order_channel: string;
  number_order_system: string | null;
  date: string | null;
  net_total_order: number | null;
  customer: PdvSalesRequestOrderCustomer | null;
  unitBusiness: PdvSalesRequestOrderUnitBusiness | null;
}

// Versão completa (/orders/:orderId). `installments` deriva de
// `order.source_payload.parcelas.length` — não é coluna própria.
export interface PdvSalesRequestOrderDetail extends PdvSalesRequestOrderSummary {
  payments: PdvSalesRequestOrderPayment[];
  installments: number | null;
  items: PdvSalesRequestOrderItem[];
}

// ─── Quadro (GET /sales-request) e detalhe (GET /:id) ───────────────────────
// Montados em helpers/card-serializers.ts — só os campos que o front usa.

// next_action é calculado na resposta (helpers/next-action.rules.ts), nunca persistido.
export interface PdvBoardCard {
  id: string;
  status: PdvSalesRequestStatus;
  shipping_label: string | null;
  next_action: string | null;
  batch_color: PdvBatchColor | null;
  order: {
    id: string;
    number_order_system: string | null;
    number_order_channel: string;
    date: string | null;
    customer: { name: string } | null;
    // Só nas telas que veem todas as lojas (finance/cd21/telesales).
    unitBusiness?: { number: string } | null;
  } | null;
  saleInvoice: { tracking_url: string | null } | null;
}

export interface PdvBoardColumnResult {
  key: string;
  label: string;
  description: string | null;
  statuses: readonly PdvSalesRequestStatus[];
  extra: boolean;
  highlighted: boolean;
  selectable: boolean;
  actions: readonly PdvColumnAction[];
  items: PdvBoardCard[];
  totalCount: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export type PdvReceiptAnalysisField =
  | "tipo_comprovante"
  | "valor_total"
  | "qtd_parcelas"
  | "valor_parcela"
  | "data_transacao"
  | "hora_transacao"
  | "instituicao_pagamento"
  | "titular_cartao"
  | "bandeira_cartao"
  | "codigo_autorizacao"
  | "nsu_cv";

// Análise enxuta pro front — payment_methods no conciliado, payment_method no comprovante.
export type PdvReceiptAnalysisView = Pick<
  PaymentReceiptReconciledAnalysis,
  PdvReceiptAnalysisField
> & {
  payment_methods?: PaymentReceiptPaymentMethod[];
  payment_method?: PaymentReceiptPaymentMethod | null;
};

export interface PdvSalesRequestDetail {
  id: string;
  status: PdvSalesRequestStatus;
  next_action: string | null;
  shipping_info_required: boolean;
  correction_origin_status: PdvSalesRequestStatus | null;
  errors: { reasons: PdvCorrectionReason[]; note: string | null } | null;
  origin: PdvSalesRequestOrigin | null;
  shipping_type: PdvShippingType | null;
  shipping_label: string | null;
  shipping_address: string | null;
  transporter_name: string | null;
  sale_invoice_id: string | null;
  transfer_invoice_id: string | null;
  payment_receipt_analysis: PdvReceiptAnalysisView | null;
  payment_receipt_validated: boolean | null;
  payment_method_matches_receipt: boolean | null;
  receipt_total_matches_order: boolean | null;
  receipt_total_difference: number | null;
  transfer_invoice_products_match_sale: boolean | null;
  expedition_progress: unknown;
  saleInvoice: {
    id: string;
    number_system: string;
    transporter_name: string | null;
    tracking_url: string | null;
  } | null;
  transferInvoice: { id: string; number_system: string } | null;
  receipts: { id: string; analysis: PdvReceiptAnalysisView | null }[];
  order: {
    number_order_system: string | null;
    number_order_channel: string;
    date: string | null;
    net_total_order: number | null;
    status: string | null;
    installments: number | null;
    customer: { name: string; document: string } | null;
    unitBusiness: { number: string; name: string } | null;
    payments: PdvSalesRequestOrderPayment[];
    items: PdvSalesRequestOrderItem[];
  } | null;
}
