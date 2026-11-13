// Fachada de lifecycle: service e repository das mudanças de status da nota (abrir, finalizar, uso e consumo, agendar).
export { default as invoiceLifecycleService, InvoiceLifecycleService } from "./services/lifecycle.service";
export { default as invoiceLifecycleRepository, InvoiceLifecycleRepository } from "./repositories/lifecycle.repository";
