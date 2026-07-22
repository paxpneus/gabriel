import { rodonavesApi } from '../../../api/rodonaves_api.service';
import { GenericOccurrenceParams, InvoiceOccurrences, TransporterHandler } from '../../../../../helpers/mappers/map-transporter-api.types';
import { RodonavesRastreamentoRequest, RodonavesRastreamentoResponse } from './occurrences.types';
import { parseRodonavesDate } from '../../../helpers/date';

const mapParams = (params: GenericOccurrenceParams): RodonavesRastreamentoRequest => ({
  TaxIdRegistration: params.cnpj,
  InvoiceNumber: String(params.invoiceNumber),
});

const fetchOccurrences = async (params: RodonavesRastreamentoRequest): Promise<RodonavesRastreamentoResponse> => {
      console.log("[Rodonaves Request Params]", params);

  const { data } = await rodonavesApi.get<RodonavesRastreamentoResponse>('/v1/tracking', {
    params,
  });
  console.log(
  "[Rodonaves Response]",
  JSON.stringify(data, null, 2)
);
  return data;
};

const mapOccurrences = (response: RodonavesRastreamentoResponse): InvoiceOccurrences[] => {
  if (!response.Events?.length) return [];

  return response.Events.map((event) => ({
    occurrency_code: String(event.ProcedaCode),
    description: event.Description,
    proof_link: undefined,
    date: parseRodonavesDate(event.Date),
  }));
};

export const rodonavesHandler: TransporterHandler<RodonavesRastreamentoRequest, RodonavesRastreamentoResponse> = {
  api: rodonavesApi,
  mapParams,
  fetchOccurrences,
  mapOccurrences,
};