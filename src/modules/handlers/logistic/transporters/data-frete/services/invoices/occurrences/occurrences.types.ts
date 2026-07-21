// ─── GET /ocorrencias/nota-fiscal ────────────────────────────────────────────

export interface DatafreteOcorrenciaNotaFiscal {
  dt_ocorrencia: string;    // "DD/MM/YYYY"
  hora_ocorrencia: string;  // "HH:mm:ss"
  observacao: string;
  codigo_ocorrencia: number;
  desc_ocorrencia: string;
}

export interface DatafreteRastreamentoResponse {
  codigo_retorno: number;
  data: DatafreteOcorrenciaNotaFiscal[];
}

export interface DatafreteRastreamentoRequest {
  "nota_fiscal[chave]"?: string;
  "nota_fiscal[numero]"?: string;
  "nota_fiscal[serie]"?: string;
  "nota_fiscal[doc_emitente]"?: string;
  "inf_comp[doc_transportador]"?: string;
}

export type DatafreteTipoDocumento = "CT" | "NF" | "";

export interface DatafreteEvento {
  tp_doc: DatafreteTipoDocumento;
  chave_doc: string;
  serie_doc: string;
  numero_doc: string;
  cod_evento: string;
  ds_evento: string;
  ds_observacao_evento: string | null;
  dt_evento: string; // "YYYY-MM-DD HH:mm:ss"
  dt_importacao: string;
}


// ─── POST /ocorrencias (Importar Ocorrências) ────────────────────────────────

export interface DatafreteOcorrenciaImportItem {
  codigo_ocorrencia: string;
  link_comprovante?: string;
  descricao_ocorrencia?: string;
  data_ocorrencia: string; // "YYYY-MM-DD HH:mm:ss"
}

export interface DatafreteDocumentoImport {
  transportador_cnpj: string;
  empresa_cnpj: string;
  numero_nf?: string;
  serie_nf?: string;
  chave_nf?: string;
  ocorrencias: DatafreteOcorrenciaImportItem[];
}

export interface DatafreteImportOcorrenciasRequest {
  documentos: DatafreteDocumentoImport[];
}

export interface DatafreteImportOcorrenciasResponse {
  codigo_retorno: number;
  mensagem: string;
}

export interface DatafreteImportInvoiceRef {
  transporterCnpj: string;
  companyCnpj: string;
  invoiceNumber?: number;
  serieNf?: string;
  chaveNf?: string;
}