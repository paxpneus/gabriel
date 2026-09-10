import { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios";

// Pacing extra opcional, aplicado ANTES de toda chamada Bling (GET e escrita),
// além do espaçamento já garantido pelo leaky-bucket em waitForBlingRateLimit
// (chamado pelo onRequest da instância `blingApi`). Serve como margem extra
// configurável por ambiente sem mexer no rate limiter global.
const BLING_ORDER_REQUEST_DELAY_MS = Number(
  process.env.BLING_ORDER_REQUEST_DELAY_MS ?? 0,
);

// Timeout por chamada individual. A instância `blingApi` já tem um timeout
// default (ver createAxiosInstance em bling_api.service.ts), mas esse default
// é único pra todo método — este valor permite override explícito por
// endpoint (ex: geração de NFe, que pode ser mais lenta que uma leitura
// simples) sem depender do default global da instância axios.
const BLING_REQUEST_TIMEOUT_MS = Number(
  process.env.BLING_REQUEST_TIMEOUT_MS ?? 20_000,
);

async function pace(): Promise<void> {
  if (BLING_ORDER_REQUEST_DELAY_MS > 0) {
    await new Promise<void>((resolve) =>
      setTimeout(resolve, BLING_ORDER_REQUEST_DELAY_MS),
    );
  }
}

function withTimeout(config?: AxiosRequestConfig): AxiosRequestConfig {
  return { timeout: BLING_REQUEST_TIMEOUT_MS, ...config };
}

export const blingGet = async <T = any>(
  url: string,
  blingApi: AxiosInstance,
  config?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> => {
  await pace();
  return blingApi.get<T>(url, withTimeout(config));
};

export const blingPost = async <T = any>(
  url: string,
  data: unknown,
  blingApi: AxiosInstance,
  config?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> => {
  await pace();
  return blingApi.post<T>(url, data, withTimeout(config));
};

export const blingPut = async <T = any>(
  url: string,
  data: unknown,
  blingApi: AxiosInstance,
  config?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> => {
  await pace();
  return blingApi.put<T>(url, data, withTimeout(config));
};

export const blingPatch = async <T = any>(
  url: string,
  data: unknown,
  blingApi: AxiosInstance,
  config?: AxiosRequestConfig,
): Promise<AxiosResponse<T>> => {
  await pace();
  return blingApi.patch<T>(url, data, withTimeout(config));
};
