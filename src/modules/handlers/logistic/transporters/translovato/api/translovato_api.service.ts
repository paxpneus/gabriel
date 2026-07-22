import axios, { AxiosInstance } from "axios";
import { createAxiosInstance } from "../../../../../../config/axios";
import integrationsService from "../../../../../integrations/integrations/integrations.service";
import ConfigToken from "../../../../../integrations/config_tokens/config_tokens.model";
import { FullIntegration } from "../../../../../integrations/integrations/integrations.types";
import { decrypt } from "../../../../../../shared/utils/normalizers/crypto/password-encrypt";

export const getTranslovatoIntegration = async (
  cacheKey?: string,
): Promise<FullIntegration> => {
  const integration = await integrationsService.getFullIntegration(
    {
      where: {
        name: "Translovato",
        type: "SYSTEM",
      },
    },
    cacheKey ? "Translovato" : undefined,
  );

  if (!integration)
    throw new Error("Integração Translovato não encontrada");

  return integration;
};

export const translovatoApi: AxiosInstance = createAxiosInstance({
  baseURL: "https://app.bbmlogistica.com.br/translovato/api",

  onRequest: async (config) => {
    const integration = await getTranslovatoIntegration();

    const { username, password: encryptedPassword } = integration.tokens;

     const password = encryptedPassword
      ? decrypt(encryptedPassword)
      : null;

    if (!username || !password) {
      throw new Error(
        "[TranslovatoApi] Usuário e/ou senha não configurados na integração",
      );
    }

    if (integration.api_url) {
      config.baseURL = integration.api_url;
    }

    config.headers.set("Content-Type", "application/json");

    config.data = {
      ...(config.data ?? {}),
      usuario: username,
      senha: password,
    };

    return config;
  },

  onResponseError: async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

  console.error("[TranslovatoApi] Erro na requisição:", {
    status: error.response?.status,
    data: error.response?.data,
    method: error.config?.method,
  });


    return Promise.reject(error);
  },
});