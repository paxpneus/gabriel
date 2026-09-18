import axios, { AxiosInstance } from "axios";
import { createAxiosInstance } from "../../../../../../config/axios";
import integrationsService from "../../../../../integrations/integrations/integrations.service";
import { FullIntegration } from "../../../../../integrations/integrations/integrations.types";

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

    // 302 não é erro real pra Datafrete — significa "dado já consta na base"
    // (ex.: CT-e já importado). Quem chama decide o que fazer com isso.
    const logFn = error.response?.status === 302 ? console.warn : console.error;

    logFn(
      `[DatafreteApi] ${error.response?.status === 302 ? "302 (já existe na base)" : "Erro na requisição"}: ` +
        `${error.response?.status} ${error.response?.statusText}`,
      JSON.stringify(error.response?.data, null, 2),
    );

    return Promise.reject(error);
  },
});