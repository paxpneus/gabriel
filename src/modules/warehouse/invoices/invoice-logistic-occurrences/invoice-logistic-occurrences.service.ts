import BaseService from "../../../../shared/utils/base-models/base-service";
import { formatToBRDate } from "../../../../shared/utils/normalizers/date";
import { extractSerieFromChaveNfe } from "../../../../shared/utils/normalizers/nfe";
import { resolveTransporterHandler } from "../../../handlers/logistic/helpers/mappers/map-transporter-api";
import {
  GenericOccurrenceParams,
  GenericPostOccurrenceParams,
  InvoiceOccurrences,
} from "../../../handlers/logistic/helpers/mappers/map-transporter-api.types";
import integrationsService from "../../../integrations/integrations/integrations.service";
import InvoiceLogisticOccurrences from "./invoice-logistic-occurrences.model";
import invoiceLogisticOccurrencesRepository, {
  InvoiceLogisticOccurrencesRepository,
} from "./invoice-logistic-occurrences.repository";
import {
  InvoiceForOccurrencePost,
  InvoiceLogisticOcurrencesAttributes,
} from "./invoice-logistic-occurrences.types";

export class InvoiceLogisticOccurrencesService extends BaseService<
  InvoiceLogisticOccurrences,
  InvoiceLogisticOccurrencesRepository
> {
  constructor() {
    super(invoiceLogisticOccurrencesRepository);
  }

  listOccurrencyByTransporter = async (
    integration_id: string,
    params: GenericOccurrenceParams,
  ): Promise<InvoiceOccurrences[]> => {
    if (!integration_id) {
      throw new Error("Id da integração não fornecido");
    }

    const integration = await integrationsService.findById(integration_id);

    if (!integration) {
      throw new Error(
        "Integração não encontrada para esta transportadora, cadastre antes de usar esta funcionalidade.",
      );
    }

    const handler = resolveTransporterHandler(integration.name);

    const transporterParams = handler.mapParams(params);
    const response = await handler.fetchOccurrences(transporterParams);

    return handler.mapOccurrences(response);
  };

  postOccurrencesByTransporter = async (
    integration_id: string,
    invoice: InvoiceForOccurrencePost,
    transporterCnpj: string,
    occurrences: InvoiceLogisticOccurrences[],
  ): Promise<void> => {
    if (!integration_id) {
      throw new Error("Id da integração não fornecido");
    }

    if (!occurrences.length) return;

    const integration = await integrationsService.findById(integration_id);

    if (!integration) {
      throw new Error(
        "Integração não encontrada para esta transportadora, cadastre antes de usar esta funcionalidade.",
      );
    }

    const handler = resolveTransporterHandler(integration.name);

    if (!handler.mapPostParams || !handler.postOccurrences) {
      throw new Error(
        `A transportadora "${integration.name}" não suporta envio (POST) de ocorrências.`,
      );
    }

    const chaveNf = invoice.xml_key ?? undefined;
    const invoiceNumber = invoice.number_system
      ? Number(invoice.number_system)
      : undefined;

    if (!chaveNf && !invoiceNumber) {
      throw new Error(
        "Nota sem xml_key e sem number_system — não é possível identificá-la para a transportadora.",
      );
    }

    const genericParams: GenericPostOccurrenceParams = {
      invoiceNumber: invoiceNumber ?? 0,
      cnpj: invoice.sender_cnpj ?? undefined,
      chaveNf,
      serieNf: chaveNf ? extractSerieFromChaveNfe(chaveNf) : undefined,
      transporterCnpj,
      occurrences: occurrences.map((o) => ({
        occurrency_code: o.occurrency_code,
        description: o.description,
        proof_link: o.proof_link,
        date: o.date,
      })),
    };

    const transporterParams = handler.mapPostParams(genericParams);

    try {
      await handler.postOccurrences(transporterParams);
      const ids = occurrences.map((o) => o.id);
      await this.bulkUpdate({ status: "SYNCHRONIZED" }, { where: { id: ids } });
    } catch (error: any) {
      console.error(
        `[InvoiceLogisticOccurrences] Falha ao enviar ocorrências da nota (invoice_id=${invoice.xml_key ?? invoice.number_system}) para transportadora:`,
        error?.response?.data ?? error?.message ?? error,
      );
      throw error;
    }
  };
}

export default new InvoiceLogisticOccurrencesService();
