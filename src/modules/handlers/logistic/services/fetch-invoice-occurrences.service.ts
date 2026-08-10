import invoiceService from "../../../warehouse/invoices/invoice/invoice.service";
import invoiceLogisticOccurrencesService from "../../../warehouse/invoices/invoice-logistic-occurrences/invoice-logistic-occurrences.service";
import invoiceLogisticOccurrencesRepository, {
  InvoiceLogisticOccurrencesRepository,
} from "../../../warehouse/invoices/invoice-logistic-occurrences/invoice-logistic-occurrences.repository";
import { InvoiceLogisticOcurrencesCreationAttributesAttributes } from "../../../warehouse/invoices/invoice-logistic-occurrences/invoice-logistic-occurrences.types";

export interface IngestPendingOccurrencesResult {
  processed: number;
  invoicesWithNewOccurrences: number;
  occurrencesCreated: number;
  failed: number;
}

export class InvoiceLogisticOccurrencesIngestionService {
  constructor(
    private readonly repository: InvoiceLogisticOccurrencesRepository = invoiceLogisticOccurrencesRepository,
  ) {}

  async ingestPendingOccurrences(): Promise<IngestPendingOccurrencesResult> {
    const invoices =
      await invoiceService.listInvoicesPendingLogisticOccurrence();

    const result: IngestPendingOccurrencesResult = {
      processed: 0,
      invoicesWithNewOccurrences: 0,
      occurrencesCreated: 0,
      failed: 0,
    };

    for (const invoice of invoices) {
      result.processed++;

      const transporter = (invoice as any).transporter as
        | { id: string; name: string; integrations_id?: string }
        | undefined;

      if (!transporter?.integrations_id) {
        console.warn(
          `[LogisticOccurrencesIngestion] Nota ${invoice.number_system} sem transportadora/integration_id vinculado. Pulando.`,
        );
        continue;
      }

      try {

        const occurrences =
          await invoiceLogisticOccurrencesService.listOccurrencyByTransporter(
            transporter.integrations_id,
            {
              invoiceNumber: Number(invoice.number_system),
              cnpj: invoice.sender_cnpj,
              chaveNf: invoice.xml_key
            },
          );

        if (!occurrences.length) continue;

        const existingCodes = await this.repository.findExistingCodes(
          invoice.id,
        );

        const newOccurrences: InvoiceLogisticOcurrencesCreationAttributesAttributes[] =
          occurrences
            .filter((o) => !existingCodes.has(o.occurrency_code))
            .map((o) => ({
              invoice_id: invoice.id,
              occurrency_code: o.occurrency_code,
              description: o.description ?? "",
              proof_link: o.proof_link ?? "",
              status: "PENDING",
              date: o.date,
            }));

        if (newOccurrences.length > 0) {
          await this.repository.bulkCreateOccurrences(newOccurrences);
          result.invoicesWithNewOccurrences++;
          result.occurrencesCreated += newOccurrences.length;
        }
      } catch (error: any) {
        result.failed++;
        console.error(
          `[LogisticOccurrencesIngestion] Falhou ao buscar ocorrências da nota ${invoice.number_system} (transportadora ${transporter.name}):`,
          error?.message ?? error,
        );
      }
    }

    return result;
  }
}

export default new InvoiceLogisticOccurrencesIngestionService();
