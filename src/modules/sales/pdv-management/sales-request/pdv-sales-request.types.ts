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
  payment_receipt_path: string | null;
  errors: PdvSalesRequestErrors | null;
  created_by_user_id: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PdvSalesRequestCreationAttributes = Omit<
  PdvSalesRequestAttributes,
  "id" | "createdAt" | "updatedAt"
>;
