// helpers/mappers/map-document-api.types.ts
import { AxiosInstance } from 'axios';

/**
 * Documento XML já normalizado no formato que a aplicação usa,
 * independente de qual provider (Sieg, etc) buscou o documento.
 */
export interface XmlDocumentResult {
  chave?: string;
  xmlBase64: string;
  numero?: string;
  serie?: string;
  cnpjEmit?: string;
  cnpjDest?: string;
  dataEmissao?: Date;
}

/**
 * Tipo de documento fiscal que estamos buscando.
 * Mantém a busca desacoplada do "TipoXml" específico do Sieg.
 */
export enum XmlDocumentType {
  CTE = 'CTE',
  NFE = 'NFE',
}

/**
 * Parâmetros genéricos que a aplicação usa para buscar documentos XML,
 * independente de qual provider vai atender a chamada.
 */
export interface GenericXmlDocumentParams {
  documentType: XmlDocumentType;
  dataEmissaoInicio: Date;
  dataEmissaoFim: Date;
  cnpjEmit?: string;
  cnpjDest?: string;
  take?: number;
  skip?: number;
}

/**
 * Contrato que todo provider de busca de XML precisa implementar.
 * TParams   -> formato de request específico do provider
 * TResponse -> formato de response específico do provider
 */
export interface DocumentSearchHandler<TParams = any, TResponse = any> {
  api: AxiosInstance;
  /** Converte os parâmetros genéricos da aplicação para o formato do provider */
  mapParams: (params: GenericXmlDocumentParams) => TParams;
  /** Executa a chamada na API do provider */
  fetchXmlDocuments: (params: TParams) => Promise<TResponse>;
  /** Normaliza a response do provider para o formato padrão da aplicação */
  mapXmlDocuments: (response: TResponse) => XmlDocumentResult[];
}