import invoiceLogisticOccurrencesService from "../../../warehouse/invoices/invoice-logistic-occurrences/invoice-logistic-occurrences.service";
import invoiceLogisticOccurrencesRepository, {
  InvoiceLogisticOccurrencesRepository,
} from "../../../warehouse/invoices/invoice-logistic-occurrences/invoice-logistic-occurrences.repository";
import InvoiceLogisticOccurrences from "../../../warehouse/invoices/invoice-logistic-occurrences/invoice-logistic-occurrences.model";
import { InvoiceForOccurrencePost } from "../../../warehouse/invoices/invoice-logistic-occurrences/invoice-logistic-occurrences.types";

export interface SyncPendingOccurrencesResult {
  invoicesProcessed: number;
  occurrencesSynced: number;
  failed: number;
}

export class SyncInvoiceOccurrencesService {
  constructor(
    private readonly repository: InvoiceLogisticOccurrencesRepository = invoiceLogisticOccurrencesRepository,
  ) {}

  async syncPendingOccurrences(): Promise<SyncPendingOccurrencesResult> {
    const result: SyncPendingOccurrencesResult = {
      invoicesProcessed: 0,
      occurrencesSynced: 0,
      failed: 0,
    };

    const pending = (await this.repository.findPendingWithInvoiceAndTransporter()) as Array<
      InvoiceLogisticOccurrences & { invoice: any }
    >;

    if (!pending.length) return result;

    // agrupa as ocorrências pendentes por nota fiscal
    const byInvoice = new Map<string, typeof pending>();
    for (const occurrence of pending) {
      const list = byInvoice.get(occurrence.invoice_id) ?? [];
      list.push(occurrence);
      byInvoice.set(occurrence.invoice_id, list);
    }

    for (const [invoiceId, occurrences] of byInvoice) {
      const invoice = occurrences[0].invoice;
      const transporter = invoice?.transporter;

      if (!transporter?.integration_id || !transporter?.cnpj) {
        console.warn(
          `[SyncInvoiceOccurrences] Nota ${invoiceId} sem transportadora/integration_id/cnpj vinculado. Pulando.`,
        );
        result.failed++;
        continue;
      }

      const invoiceForPost: InvoiceForOccurrencePost = {
        xml_key: invoice.xml_key,
        number_system: invoice.number_system,
        sender_cnpj: invoice.sender_cnpj,
      };

      try {
        await invoiceLogisticOccurrencesService.postOccurrencesByTransporter(
          transporter.integration_id,
          invoiceForPost,
          transporter.cnpj,
          occurrences,
        );

        result.invoicesProcessed++;
        result.occurrencesSynced += occurrences.length;
      } catch (error: any) {
        result.failed++;
        console.error(
          `[SyncInvoiceOccurrences] Falha ao sincronizar nota ${invoiceId}:`,
          error?.message ?? error,
        );
      }
    }

    return result;
  }
}

export default new SyncInvoiceOccurrencesService();