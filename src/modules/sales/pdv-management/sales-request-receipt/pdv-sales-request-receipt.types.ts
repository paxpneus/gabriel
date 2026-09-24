import { PaymentReceiptExtraction } from "../sales-request/pdv-sales-request.types";

export interface PdvSalesRequestReceiptAttributes {
  id: string;
  pdv_sales_request_id: string;
  path: string;
  // Extração crua deste comprovante — null enquanto a análise assíncrona não
  // termina, ou quando ela falha. A visão conciliada de TODOS os comprovantes
  // da solicitação fica em pdv_sales_requests.payment_receipt_analysis (ver
  // PdvSalesRequestReceiptReconciledAnalysis/reconcileReceipts).
  analysis: PaymentReceiptExtraction | null;
  validated: boolean | null;
  fingerprint: string | null;
  created_by_user_id: string | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export type PdvSalesRequestReceiptCreationAttributes = Omit<
  PdvSalesRequestReceiptAttributes,
  "id" | "createdAt" | "updatedAt"
>;
