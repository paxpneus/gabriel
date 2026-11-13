// Fachada de ingestion (nota provisória e import de XML); controller fica fora (só o invoice.routes.ts importa).
export { default as invoiceIngestionService, InvoiceIngestionService } from "./services/ingestion.service";
export { default as invoiceIngestionRepository, InvoiceIngestionRepository } from "./repositories/ingestion.repository";
export * from "./helpers/tracking-url";
export * from "./helpers/return-invoice";
