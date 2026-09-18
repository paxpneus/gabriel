// ─── POST /conhecimento-transporte/xml ───────────────────────────────────────

export interface DatafreteImportCteXmlResponse {
  codigo_retorno: number;
  mensagem: string;
}

// ─── POST /conhecimento-transporte (JSON) ────────────────────────────────────

export interface DatafreteImportCteJsonRequest {
  xml: string;
}

// ─── GET /conhecimento-transporte (Listar CT-e) ──────────────────────────────

export interface DatafreteListCteFilters {
  dt_emi_ini_ct?: string; // "YYYY-MM-DD"
  dt_emi_fim_ct?: string; // "YYYY-MM-DD"
  cod_empresa?: string;
  doc_empresa?: string;
  numero_ct?: string;
  id_fatura?: string;
  id_ct?: string;
  chave_ct?: string;
}

export interface DatafreteDocumentoTransportado {
  doc_tp: string;
  doc_serie: string;
  doc_numero: string;
  doc_chave: string;
  doc_emi: string;
}

export interface DatafreteListaTaxa {
  vl_fretepeso: number;
  vl_fretevalor: number;
  vl_pedagio: number;
  vl_outros: number;
}

export interface DatafreteListaCteItem {
  id_ct: number;
  tp_doc: string;
  serie_ct: string;
  numero_ct: string;
  chave_ct: string;
  dt_emi: string;
  hora_emi: string;
  doc_transp: string;
  doc_rem: string;
  doc_dest: string;
  doc_toma: string;
  tp_pag: string;
  tp_toma: number;
  vl_mercadoria: number;
  vl_frete: number;
  vl_icms: number;
  vl_aliqicms: number;
  vl_bcalcicms: number;
  peso_bcalc: number;
  qtd_volume: number;
  cfop: string;
  modal: string;
  tp_ct: string;
  tp_serv: string;
  lista_documento_transportado: DatafreteDocumentoTransportado[];
  lista_taxa: DatafreteListaTaxa;
}

export interface DatafreteListCteResponse {
  codigo_retorno: number;
  evento: {
    filtro_interno: DatafreteListCteFilters;
    pagina_atual: number;
    qtd_pagina: number;
    qtd_registro: number;
    lista_ct: DatafreteListaCteItem[];
  };
}
