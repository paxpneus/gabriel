import { TransporterHandler } from './map-transporter-api.types';
import { alfaTransportesHandler } from '../../transporters/alfa-transportes/services/invoices/occurrences/occurrences.service';
import { datafreteHandler } from '../../transporters/data-frete/services/invoices/occurrences/occurrences.service';
import { rodonavesHandler } from '../../transporters/rodonaves/services/invoices/occurrences/occurrences.service';
import { translovatoHandler } from '../../transporters/translovato/services/invoices/occurrences/occurrences.service';

/**
 * Registry central: cada transportadora nova só precisa de uma entrada aqui.
 */
const transporterHandlers: Record<string, TransporterHandler> = {
  'Alfa-Transportes': alfaTransportesHandler,
  'Rodonaves': rodonavesHandler,
  'Translovato': translovatoHandler,
  'Datafrete': datafreteHandler,
};

/**
 * "Descobre" o handler (api + funções) da transportadora pelo nome da integração.
 */
export const resolveTransporterHandler = (integration_name: string): TransporterHandler => {
  const handler = transporterHandlers[integration_name];

  if (!handler) {
    throw new Error(`Transportadora "${integration_name}" não possui integração implementada.`);
  }

  return handler;
};