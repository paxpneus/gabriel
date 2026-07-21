
import { datafreteApi } from '../../../api/data-frete_api.service';
import {
  GenericOccurrenceParams,
  GenericPostOccurrenceParams,
  InvoiceOccurrences,
  TransporterHandler,
} from '../../../../../helpers/mappers/map-transporter-api.types';
import {
  DatafreteRastreamentoRequest,
  DatafreteRastreamentoResponse,
  DatafreteImportOcorrenciasRequest,
  DatafreteImportOcorrenciasResponse,
  DatafreteDocumentoImport,
} from './occurrences.types';
import { onlyDigits } from '../../../helpers/normalizers';
import { formatToDatafretePayloadDate, parseDatafreteDateTime } from '../../../helpers/date';

// ─── GET /ocorrencias/nota-fiscal ────────────────────────────────────────────

const mapParams = (params: GenericOccurrenceParams): DatafreteRastreamentoRequest => {
  const request: DatafreteRastreamentoRequest = {};

  if (params.chaveNf) {
    request['nota_fiscal[chave]'] = params.chaveNf;
  } else {
    request['nota_fiscal[numero]'] = String(params.invoiceNumber);
    if (params.serieNf) request['nota_fiscal[serie]'] = params.serieNf;
    if (params.cnpj) request['nota_fiscal[doc_emitente]'] = onlyDigits(params.cnpj);
  }

  if (params.cnpj) {
    request['inf_comp[doc_transportador]'] = onlyDigits(params.cnpj);
  }

  return request;
};

const fetchOccurrences = async (
  params: DatafreteRastreamentoRequest,
): Promise<DatafreteRastreamentoResponse> => {
  const { data } = await datafreteApi.get<DatafreteRastreamentoResponse>(
    '/ocorrencias/nota-fiscal',
    { params },
  );
  return data;
};

const mapOccurrences = (response: DatafreteRastreamentoResponse): InvoiceOccurrences[] => {
  if (!response.data?.length) return [];

  return response.data.map((evento) => ({
    occurrency_code: String(evento.codigo_ocorrencia),
    description: evento.desc_ocorrencia || evento.observacao || '',
    date: parseDatafreteDateTime(evento.dt_ocorrencia, evento.hora_ocorrencia),
    proof_link: undefined, // este endpoint não retorna link de comprovante
  }));
};

// ─── POST /ocorrencias ────────────────────────────────────────────────────────

const mapPostParams = (
  params: GenericPostOccurrenceParams,
): DatafreteImportOcorrenciasRequest => {
  const documento: DatafreteDocumentoImport = {
    transportador_cnpj: params.transporterCnpj,
    empresa_cnpj: onlyDigits(params.cnpj) ?? '',
    ...(params.chaveNf
      ? { chave_nf: params.chaveNf }
      : {
          numero_nf: String(params.invoiceNumber),
          serie_nf: params.serieNf,
        }),
    ocorrencias: params.occurrences.map((o) => ({
      codigo_ocorrencia: o.occurrency_code,
      link_comprovante: o.proof_link,
      descricao_ocorrencia: o.description,
      data_ocorrencia: o.date ? formatToDatafretePayloadDate(o.date) : '',
    })),
  };

  return { documentos: [documento] };
};

const postOccurrences = async (
  payload: DatafreteImportOcorrenciasRequest,
): Promise<DatafreteImportOcorrenciasResponse> => {
  const { data } = await datafreteApi.post<DatafreteImportOcorrenciasResponse>(
    '/ocorrencias',
    payload,
  );
  return data;
};

export const datafreteHandler: TransporterHandler<
  DatafreteRastreamentoRequest,
  DatafreteRastreamentoResponse,
  DatafreteImportOcorrenciasRequest,
  DatafreteImportOcorrenciasResponse
> = {
  api: datafreteApi,
  mapParams,
  fetchOccurrences,
  mapOccurrences,
  mapPostParams,
  postOccurrences,
};