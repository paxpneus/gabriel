import { AxiosInstance } from 'axios';

export interface InvoiceOccurrences {
  occurrency_code: string;
  proof_link?: string;
  description?: string;
  date?: string;
}

/**
 * Parâmetros genéricos que a aplicação usa para consultar ocorrências,
 * independente de qual transportadora vai atender a chamada.
 */
export interface GenericOccurrenceParams {
  invoiceNumber: number;
  cnpj?: string;
}

/**
 * Contrato que toda transportadora precisa implementar.
 * TParams  -> formato de request específico da transportadora
 * TResponse -> formato de response específico da transportadora
 */
export interface TransporterHandler<TParams = any, TResponse = any> {
  api: AxiosInstance;
  /** Converte os parâmetros genéricos da aplicação para o formato da transportadora */
  mapParams: (params: GenericOccurrenceParams) => TParams;
  /** Executa a chamada na API da transportadora */
  fetchOccurrences: (params: TParams) => Promise<TResponse>;
  /** Normaliza a response da transportadora para o formato padrão da aplicação */
  mapOccurrences: (response: TResponse) => InvoiceOccurrences[];
}