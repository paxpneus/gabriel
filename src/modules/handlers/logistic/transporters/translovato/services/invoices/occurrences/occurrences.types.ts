export interface TranslovatoRastreamentoRequest {
  ChaveNF?: string;
  NrNotaFiscal: number | string;
  cnpj?: string;
}

export interface TranslovatoOcorrencia {
  CdRemetente: string;
  CdDestinatario: string;
  Filail_CTE: string;
  CNPJ_Filial_CTE: string;
  Serie_CTE: string;
  Numero_CTE: number;
  Cod_Ocorrencia: string;
  Tipo_Movimento: string;
  Data_Ocorrencia: string;
  Hora_Ocorrencia: string;
  Data_AgEndamento: string;
  OBS_Ocorrencia: string;
  Cidade_ocorrencia: string;
}

export type TranslovatoRastreamentoResponse = TranslovatoOcorrencia[];