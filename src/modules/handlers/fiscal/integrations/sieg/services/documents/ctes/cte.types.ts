// integrations/sieg/services/documents/xml-documents.types.ts

/** TipoXml aceito pela API do Sieg (BaixarXmls) */
export enum SiegTipoXml {
  NFE = 1,
  CTE = 2, // confirmar valor exato na doc do Sieg antes de subir pra prod
}

export interface SiegBaixarXmlsRequest {
  TipoXml: SiegTipoXml;
  Take: number;
  Skip: number;
  DataEmissaoInicio: string; // ISO 8601
  DataEmissaoFim: string; // ISO 8601
  CNPJemit?: string;
  CNPJdest?: string;
  CNPJrem?: string;
  CNPJtom?: string;
}

/**
 * Sieg retorna um array de XMLs em base64 (BaixarXmls).
 * Ajustar aqui se a resposta real vier em outro shape (ex: { xmls: string[] }).
 */
export type SiegBaixarXmlsResponse = string[];