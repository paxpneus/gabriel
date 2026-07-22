import { translovatoApi } from '../../../api/translovato_api.service';
import { GenericOccurrenceParams, InvoiceOccurrences, TransporterHandler } from '../../../../../helpers/mappers/map-transporter-api.types';
import { TranslovatoRastreamentoRequest, TranslovatoRastreamentoResponse } from './occurrences.types';
import { parseTranslovatoDate } from '../../../helpers/date';

const mapParams = (params: GenericOccurrenceParams): TranslovatoRastreamentoRequest => ({
  ChaveNF: String(params.chaveNf),
  NrNotaFiscal: String(params.invoiceNumber),
  cnpj: String(params.cnpj),
});

const fetchOccurrences = async (params: TranslovatoRastreamentoRequest): Promise<TranslovatoRastreamentoResponse> => {
  const { data } = await translovatoApi.post<TranslovatoRastreamentoResponse>('/v1/rastreamento', params);
  return data;
};

const mapOccurrences = (response: TranslovatoRastreamentoResponse): InvoiceOccurrences[] => {
  if (!response?.length) return [];

  return response.map((ocorrencia) => ({
    occurrency_code: String(ocorrencia.Cod_Ocorrencia),
    description: ocorrencia.Tipo_Movimento,
    proof_link: undefined,
    date: parseTranslovatoDate(ocorrencia.Data_Ocorrencia, ocorrencia.Hora_Ocorrencia),
  }));
};

export const translovatoHandler: TransporterHandler<TranslovatoRastreamentoRequest, TranslovatoRastreamentoResponse> = {
  api: translovatoApi,
  mapParams,
  fetchOccurrences,
  mapOccurrences,
};