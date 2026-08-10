import invoiceLogisticOccurrencesService from "../../../warehouse/fiscal/invoices/invoice-logistic-occurrences/invoice-logistic-occurrences.service";
import invoiceLogisticOccurrencesRepository, {
  InvoiceLogisticOccurrencesRepository,
} from "../../../warehouse/fiscal/invoices/invoice-logistic-occurrences/invoice-logistic-occurrences.repository";
import InvoiceLogisticOccurrences from "../../../warehouse/fiscal/invoices/invoice-logistic-occurrences/invoice-logistic-occurrences.model";
import { InvoiceForOccurrencePost } from "../../../warehouse/fiscal/invoices/invoice-logistic-occurrences/invoice-logistic-occurrences.types";
import { getDatafreteIntegration } from "../transporters/data-frete/api/data-frete_api.service";

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

    const pending =
      (await this.repository.findPendingWithInvoiceAndTransporter()) as Array<
        InvoiceLogisticOccurrences & { invoice: any }
      >;

    if (!pending.length) return result;

    const datafreteIntegration = await getDatafreteIntegration();

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

      if (!transporter?.integrations_id || !transporter?.cnpj) {
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
        const response =
          await invoiceLogisticOccurrencesService.postOccurrencesByTransporter(
            datafreteIntegration.id,
            invoiceForPost,
            transporter.cnpj,
            occurrences,
          );

        console.log(
          `[SyncInvoiceOccurrences] Resposta Datafrete nota ${invoiceId}:`,
          JSON.stringify(response, null, 2),
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
