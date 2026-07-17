import { alfaTransportesApi } from '../../../api/alfa_api.service';
import { GenericOccurrenceParams, InvoiceOccurrences, TransporterHandler } from '../../../../../helpers/mappers/map-transporter-api.types';
import { AlfaRastreamentoRequest, AlfaRastreamentoResponse } from './occurrences.types';

const mapParams = (params: GenericOccurrenceParams): AlfaRastreamentoRequest => ({
  merNF: params.invoiceNumber,
  tomCnpj: params.cnpj ? Number(params.cnpj) : undefined,
});

const fetchOccurrences = async (params: AlfaRastreamentoRequest): Promise<AlfaRastreamentoResponse> => {
  const { data } = await alfaTransportesApi.post<AlfaRastreamentoResponse>('/rastreamento/v1.3/', params);
  return data;
};

const mapOccurrences = (response: AlfaRastreamentoResponse): InvoiceOccurrences[] => {
  if (!response.ocorrenciasExtras?.length) return [];

  return response.ocorrenciasExtras.map((ocorrencia) => ({
    occurrency_code: String(ocorrencia.codigoOcorrencia),
    description: ocorrencia.descricaoOcorrencia,
    proof_link: response.dadosEntrega?.urlComprovante,
  }));
};

export const alfaTransportesHandler: TransporterHandler<AlfaRastreamentoRequest, AlfaRastreamentoResponse> = {
  api: alfaTransportesApi,
  mapParams,
  fetchOccurrences,
  mapOccurrences,
};