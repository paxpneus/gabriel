// Fachada de internal (nota interna série B da Tecinco); controller fica fora (só o invoice.routes.ts importa).
export { default as internalInvoiceService, InternalInvoiceService } from "./services/internal.service";
export type { InternalInvoiceParty, UpsertInternalInvoiceParams } from "./services/internal.service";
export { default as internalInvoiceRepository, InternalInvoiceRepository } from "./repositories/internal.repository";
export type { InternalInvoiceBranchSide } from "./repositories/internal.repository";
