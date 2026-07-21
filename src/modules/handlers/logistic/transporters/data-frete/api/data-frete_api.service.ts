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

  onResponseError: async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    console.error(
      `[DatafreteApi] Erro na requisição: ${error.response?.status} ${error.response?.statusText}`,
    );

    return Promise.reject(error);
  },
});