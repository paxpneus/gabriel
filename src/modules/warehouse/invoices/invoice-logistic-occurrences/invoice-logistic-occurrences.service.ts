import BaseService from "../../../../shared/utils/base-models/base-service";
import { resolveTransporterHandler } from "../../../handlers/logistic/helpers/mappers/map-transporter-api";
import { GenericOccurrenceParams, InvoiceOccurrences } from "../../../handlers/logistic/helpers/mappers/map-transporter-api.types";
import integrationsService from "../../../integrations/integrations/integrations.service";
import InvoiceLogisticOccurrences from "./invoice-logistic-occurrences.model";
import invoiceLogisticOccurrencesRepository, {
  InvoiceLogisticOccurrencesRepository,
} from "./invoice-logistic-occurrences.repository";
import { InvoiceLogisticOcurrencesAttributes } from "./invoice-logistic-occurrences.types";

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
}

export default new InvoiceLogisticOccurrencesService();
