// Fachada de cancellation: service e repository de cancelamento de nota.
export { default as invoiceCancellationService, InvoiceCancellationService } from "./services/cancellation.service";
export { default as invoiceCancellationRepository, InvoiceCancellationRepository } from "./repositories/cancellation.repository";
export type { InvoiceCancellationTarget } from "./types/cancellation.types";
