import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { createAxiosInstance } from "../../../../../../config/axios";
import integrationsService from "../../../../../integrations/integrations/integrations.service";
import { FullIntegration } from "../../../../../integrations/integrations/integrations.types";

const DATAFRETE_429_MAX_RETRIES = Number(process.env.DATAFRETE_429_MAX_RETRIES ?? 5);
const DATAFRETE_429_BASE_DELAY_MS = Number(
  process.env.DATAFRETE_429_BASE_DELAY_MS ?? 3000,
);
const DATAFRETE_429_MAX_DELAY_MS = Number(
  process.env.DATAFRETE_429_MAX_DELAY_MS ?? 60000,
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryAfterMs(retryAfter?: string): number | null {
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

  return null;
}

export const getDatafreteIntegration = async (
  cacheKey?: string,
): Promise<FullIntegration> => {
  const integration = await integrationsService.getFullIntegration(
    {
      where: {
        name: "Datafrete",
        type: "SYSTEM",
      },
    },
    cacheKey ? "Datafrete" : undefined,
  );

  if (!integration)
    throw new Error("Integração Datafrete não encontrada");

  return integration;
};

export const datafreteApi: AxiosInstance = createAxiosInstance({
  baseURL: "https://services.v1.datafreteapi.com/",

  onRequest: async (config) => {
    const integration = await getDatafreteIntegration();

    const apiKey = integration.tokens.access_token;

    if (!apiKey) {
      throw new Error("[DatafreteApi] API key não configurada");
    }

    if (integration.api_url) {
      config.baseURL = integration.api_url;
    }

    config.headers.set("X-api-key", apiKey)

    return config;
  },

  onResponse: async (response) => {
    console.log(
      `[DatafreteApi] ${response.config.method?.toUpperCase()} ${response.config.url} → status=${response.status}`,
      JSON.stringify(response.data, null, 2),
    );
    return response;
  },

  onResponseError: async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    const originalRequest = error.config as AxiosRequestConfig & {
      _datafrete429Retries?: number;
    };

    const status = error.response?.status;

    if (status === 429) {
      const attempt = originalRequest._datafrete429Retries ?? 0;

      if (attempt >= DATAFRETE_429_MAX_RETRIES) {
        return Promise.reject(error);
      }

      originalRequest._datafrete429Retries = attempt + 1;

      const retryAfterMs = getRetryAfterMs(
        error.response?.headers?.["retry-after"],
      );
      const exponentialDelayMs = Math.min(
        DATAFRETE_429_BASE_DELAY_MS * 2 ** attempt,
        DATAFRETE_429_MAX_DELAY_MS,
      );
      const delayMs = Math.min(
        retryAfterMs ?? exponentialDelayMs,
        DATAFRETE_429_MAX_DELAY_MS,
      );

      console.warn(
        `[DatafreteApi] 429 rate limit. Tentando novamente em ${Math.ceil(delayMs / 1000)}s (${attempt + 1}/${DATAFRETE_429_MAX_RETRIES})`,
      );

      await sleep(delayMs);
      return datafreteApi(originalRequest);
    }

    // 302 não é erro real pra Datafrete — significa "dado já consta na base"
    // (ex.: CT-e já importado). Quem chama decide o que fazer com isso.
    const logFn = status === 302 ? console.warn : console.error;

    logFn(
      `[DatafreteApi] ${status === 302 ? "302 (já existe na base)" : "Erro na requisição"}: ` +
        `${status} ${error.response?.statusText}`,
      JSON.stringify(error.response?.data, null, 2),
    );

    return Promise.reject(error);
  },
});