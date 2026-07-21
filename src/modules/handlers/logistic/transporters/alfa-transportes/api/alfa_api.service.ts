import axios, { AxiosInstance } from "axios";
import { createAxiosInstance } from "../../../../../../config/axios";
import integrationsService from "../../../../../integrations/integrations/integrations.service";
import ConfigToken from "../../../../../integrations/config_tokens/config_tokens.model";
import { FullIntegration } from "../../../../../integrations/integrations/integrations.types";


export const getAlfaIntegration = async (
  cacheKey?: string,
): Promise<FullIntegration> => {
  const integration = await integrationsService.getFullIntegration(
    {
      where: {
        name: "Alfa-Transportes",
        type: "SYSTEM",
      },
    },
    cacheKey ? "Alfa-Transportes" : undefined,
  );

  if (!integration)
    throw new Error("Integração Alfa Transportes não encontrada");

  return integration;
};


export const alfaTransportesApi: AxiosInstance = createAxiosInstance({
  baseURL: "https://api.alfatransportes.com.br",

  onRequest: async (config) => {
    const integration = await getAlfaIntegration();

    const apiKey = integration.tokens.api_key;

    if (!apiKey) {
      throw new Error("[AlfaTransportesApi] API key não configurada");
    }

    if (integration.api_url) {
      config.baseURL = integration.api_url;
    }

    config.data = {
      ...(config.data ?? {}),
      idr: apiKey,
    };

    return config;
  },

  onResponseError: async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    console.error(
      `[AlfaTransportesApi] Erro na requisição: ${error.response?.status} ${error.response?.statusText}`,
    );

    return Promise.reject(error);
  },
});
