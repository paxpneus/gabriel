// integrations/sieg/services/documents/xml-documents.service.ts
import { siegApi } from '../../../api/sieg_api.service';
import {
  DocumentSearchHandler,
  GenericXmlDocumentParams,
  XmlDocumentResult,
} from '../../../../helpers/mappers/documents/map-fiscal-documents.types';
import { SiegBaixarXmlsRequest, SiegBaixarXmlsResponse, SiegTipoXml } from './cte.types';

const mapParams = (params: GenericXmlDocumentParams): SiegBaixarXmlsRequest => ({
  TipoXml: SiegTipoXml.CTE,
  Take: params.take ?? 0,
  Skip: params.skip ?? 0,
  DataEmissaoInicio: params.dataEmissaoInicio.toISOString(),
  DataEmissaoFim: params.dataEmissaoFim.toISOString(),
  CNPJemit: params.cnpjEmit,
  CNPJdest: params.cnpjDest,
});

const fetchXmlDocuments = async (params: SiegBaixarXmlsRequest): Promise<SiegBaixarXmlsResponse> => {
  console.log('[Sieg Request Params]', params);

  const { data } = await siegApi.post<SiegBaixarXmlsResponse>('/v1/baixar-xmls', params);

  console.log('[Sieg Response] total de xmls recebidos:', data?.length ?? 0);

  return data;
};

const mapXmlDocuments = (response: SiegBaixarXmlsResponse): XmlDocumentResult[] => {
  if (!response?.length) return [];

  return response.map((xmlBase64) => ({
    xmlBase64,
  }));
};

export const siegDocumentHandler: DocumentSearchHandler<SiegBaixarXmlsRequest, SiegBaixarXmlsResponse> = {
  api: siegApi,
  mapParams,
  fetchXmlDocuments,
  mapXmlDocuments,
};