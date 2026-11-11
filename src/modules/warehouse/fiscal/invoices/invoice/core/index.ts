// Fachada do core (CRUD, listagens e detalhe da nota). Controller fica fora: só o invoice.routes.ts importa (ver CLAUDE.md).
export { default as invoiceService, InvoiceService } from "./services/invoice.service";
export { default as invoiceRepository, InvoiceRepository } from "./repositories/invoice.repository";
export type { PendingBatchByTransporterRow } from "./types/core.types";
