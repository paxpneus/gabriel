export type SefazEnvironment = "producao" | "homologacao";

export interface SefazConsultaParams {
  cnpj: string;
  cUF: string;
  ultNSU: string;
}

export interface SefazDocumento {
  NSU: string;
  schema: string;
  xmlBase64: string;
}

export interface SefazDistribuicaoResponse {
  ultNSU: string;
  maxNSU: string;
  cStat: string;
  xMotivo: string;
  documentos: SefazDocumento[];
}