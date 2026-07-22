export interface RodonavesRastreamentoRequest {
  TaxIdRegistration?: string;
  InvoiceNumber: string;
}

export interface RodonavesEvent {
  Date: string;
  Description: string;
  EventCode: string;
  ProcedaCode: string;
  HistoricId: number;
  OccurrenceDate: string;
  NewDateSchedule: string;
  Reason: string;
}

export interface RodonavesRastreamentoResponse {
  ProtocolNumber: string;
  BillOfLadingId: number;
  CTeNumber: string;
  SenderDescription: string;
  SenderTaxIdRegistration: string;
  RecipientDescription: string;
  RecipientTaxIdRegistration: string;
  ExpectedDeliveryDays: number;
  EmissionDate: string;
  FiscalDocumentNumber: string;
  ListFiscalDocument: string[];
  SerialCTE: string;
  UnitEmi: string;
  UnitDestination: string;
  Events: RodonavesEvent[];
  IsDeliveryReceiptBlocked: boolean;
  NewDateSchedule: string;
  RefusedInvoice: string[];
}