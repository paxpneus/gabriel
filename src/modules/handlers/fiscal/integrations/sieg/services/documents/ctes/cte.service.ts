// integrations/sieg/services/documents/xml-documents.service.ts
import { siegApi } from '../../../api/sieg_api.service';
import { unzipBuffer } from '../../../../../../../../shared/utils/normalizers/zip';
import {
  DocumentSearchHandler,
  GenericXmlDocumentParams,
  XmlDocumentResult,
} from '../../../../../helpers/mappers/documents/map-fiscal-documents.types';
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

  const { data } = await siegApi.post<ArrayBuffer | unknown[]>('/v1/baixar-xmls', params, {
    responseType: 'arraybuffer', 
  });

  if (Array.isArray(data)) {
    console.log('[Sieg Response] total de xmls recebidos: 0 (sem resultados)');
    return [];
  }

  const zipBuffer = Buffer.from(data as ArrayBuffer);

  const xmlContents = unzipBuffer(zipBuffer, { extension: 'xml' }).map((entry) => entry.content);

  console.log('[Sieg Response] total de xmls recebidos:', xmlContents.length);

  return xmlContents;
};

const mapXmlDocuments = (response: SiegBaixarXmlsResponse): XmlDocumentResult[] => {
  if (!response?.length) return [];

  return response.map((xmlContent) => ({
    xmlBase64: Buffer.from(xmlContent, 'utf-8').toString('base64'),
  }));
};

export const siegDocumentHandler: DocumentSearchHandler<SiegBaixarXmlsRequest, SiegBaixarXmlsResponse> = {
  api: siegApi,
  mapParams,
  fetchXmlDocuments,
  mapXmlDocuments,
};