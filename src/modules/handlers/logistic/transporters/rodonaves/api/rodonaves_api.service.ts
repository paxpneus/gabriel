import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { createAxiosInstance } from "../../../../../../config/axios";
import integrationsService from "../../../../../integrations/integrations/integrations.service";
import ConfigToken from "../../../../../integrations/config_tokens/config_tokens.model";
import { FullIntegration } from "../../../../../integrations/integrations/integrations.types";
import { decrypt } from "../../../../../../shared/utils/normalizers/crypto/password-encrypt";

export const getRodonavesIntegration = async (
  cacheKey?: string,
): Promise<FullIntegration> => {
  const integration = await integrationsService.getFullIntegration(
    {
      where: {
        name: "Rodonaves",
        type: "SYSTEM",
      },
    },
    cacheKey ? "Rodonaves" : undefined,
  );

  if (!integration) throw new Error("Integração Rodonaves não encontrada");

  return integration;
};

/**
 * Faz login na Rodonaves e persiste o novo access_token no config_tokens.
 */
const loginRodonaves = async (
  integration: FullIntegration,
): Promise<string> => {
  const { username, password: encryptedPassword, access_token_url } = integration.tokens;

    const password = encryptedPassword
  ? decrypt(encryptedPassword)
  : null;


  if (!username || !password) {
    throw new Error(
      "[RodonavesApi] Usuário e/ou senha não configurados na integração",
    );
  }

  const body = new URLSearchParams({
    auth_type: "DEV",
    grant_type: "password",
    username,
    password,
  });

  const { data } = await axios.post(access_token_url, body, {
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  const accessToken = data?.access_token;

  if (!accessToken) {
    throw new Error("[RodonavesApi] Login não retornou access_token");
  }

  await ConfigToken.update(
    {
      access_token: accessToken,
      refresh_token: data?.refresh_token ?? null,
    },
    {
      where: { integrations_id: integration.id },
    },
  );

  // Mantém o objeto em memória sincronizado, caso getFullIntegration
  // esteja usando cache (cacheKey) e não busque de novo em seguida.
  integration.tokens.access_token = accessToken;
  integration.tokens.refresh_token = data?.refresh_token ?? null;

  return accessToken;
};

export const rodonavesApi: AxiosInstance = createAxiosInstance({
  baseURL: "https://tracking-apigateway.rte.com.br/api",

  onRequest: async (config) => {
      console.log("[RodonavesApi] entrou no onRequest");

    const integration = await getRodonavesIntegration();

    if (integration.api_url) {
      config.baseURL = integration.api_url;
    }

    let accessToken = integration.tokens.access_token;

    // Ainda não tem token: faz login antes de seguir com a requisição.
    if (!accessToken) {
      accessToken = await loginRodonaves(integration);
    }

    config.headers.set("Authorization", `Bearer ${accessToken}`);

    return config;
  },

  onResponseError: async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    const originalRequest = error.config as
      | (AxiosRequestConfig & { _retry?: boolean })
      | undefined;

    // Erro de autenticação: faz login de novo e repete a requisição uma vez.
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;

      try {
        const integration = await getRodonavesIntegration();
        const accessToken = await loginRodonaves(integration);

        originalRequest.headers = {
          ...(originalRequest.headers ?? {}),
          Authorization: `Bearer ${accessToken}`,
        };

        return rodonavesApi(originalRequest);
      } catch (loginError) {
        console.error(
          `[RodonavesApi] Falha ao tentar reautenticar: ${loginError}`,
        );
        return Promise.reject(loginError);
      }
    }

    console.error(
      `[RodonavesApi] Erro na requisição: ${error.response?.status} ${error.response?.statusText}`,
    );

    return Promise.reject(error);
  },
});
