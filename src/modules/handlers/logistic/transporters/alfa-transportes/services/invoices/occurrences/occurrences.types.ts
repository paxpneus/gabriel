export interface AlfaRastreamentoRequest {
  merNF: number;
  tomCnpj?: number;
}



export type AlfaRastreamentoStatus = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface AlfaDadosTransportadora {
  nomeTransportadora: string;
  cnpjTransportadora: string;
  cidadeTransportadora: string;
}

export interface AlfaDadosRemetente {
  nomeRemetente: string;
  cnpjRemetente: string;
}

export interface AlfaNotaFiscal {
  numero: string;
  serie: string;
  chave: string;
}

export interface AlfaDadosCte {
  notas: AlfaNotaFiscal[];
  numeroCte: string;
  valorCte: number;
  dataEmissao: string;
  dataPrivista: string;
  nomeDestinatario: string;
  agenciaInicio: string;
  agenciaFim: string;
  cidadeEntrega: string;
}

export interface AlfaComplementar {
  tipoCte: string;
  numeroCte: string;
  serieCte: string;
  valorCte: number;
}

export interface AlfaDadosEmbarque {
  cidadeDestino: string;
  cidadeOrigem: string;
  codigoViagem: number;
  horaChegada: string;
  horaSaida: string;
}

export interface AlfaDadosEntrega {
  recebedorMercadoria: string;
  dataEntrega: string;
  urlComprovante: string;
}

export interface AlfaOcorrenciaExtra {
  codigoOcorrencia: number;
  dataOcorrencia: string;
  descricaoOcorrencia: string;
}

export interface AlfaRastreamentoResponse {
  status: AlfaRastreamentoStatus;
  nome: string;
  dadosTransportadora?: AlfaDadosTransportadora;
  dadosRemetente?: AlfaDadosRemetente;
  dadosCte?: AlfaDadosCte;
  complemetar?: AlfaComplementar[];
  dadosEmbarque?: AlfaDadosEmbarque[];
  dadosEntrega?: AlfaDadosEntrega;
  ocorrenciasExtras?: AlfaOcorrenciaExtra[];
}