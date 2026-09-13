import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { createAxiosInstance } from "../../../../config/axios";
import integrationsService from "../../../integrations/integrations/integrations.service";
import { QueueItem, MercadoLivreTokenResponse } from "./mercado-livre_api.types";
import { FullIntegration } from "../../../integrations/integrations/integrations.types";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";

let isRefreshing = false;
let failedQueue: QueueItem[] = [];

function processQueue(error: unknown, token: string | null = null): void {
  failedQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token!),
  );
  failedQueue = [];
}

export const getMercadoLivreIntegration = async (
  cacheKey?: string,
): Promise<FullIntegration> => {
  const integration = await integrationsService.getFullIntegration(
    {
      where: {
        name: "MercadoLivre",
        type: "SYSTEM",
      },
    },
    cacheKey ? "MercadoLivre" : undefined,
  );

  if (!integration) throw new Error("Integração MercadoLivre não encontrada");

  return integration;
};

const getMercadoLivreToken = async () => {
  const integration = await getMercadoLivreIntegration("MercadoLivre");

  const token = integration.tokens;
  if (!token)
    throw new Error("[MercadoLivreApi] Nenhum configToken encontrado");

  return token;
};

// Renova um token que já existe.
//
// TODO (Etapa 1 — validar contra API real): a Bling exige Basic Auth de
// client_id:client_secret no header pro refresh; o Mercado Livre PODE
// esperar client_id/client_secret como parâmetros de BODY em vez de Basic
// Auth (comum em implementações OAuth2 de marketplace). Confirmar contra
// a documentação/sandbox real do ML antes da Etapa 2 depender disso.
export const doRefreshToken = async (): Promise<string> => {
  const integration = await getMercadoLivreIntegration();

  const configToken = integration.tokens;
  if (!configToken)
    throw new Error("[MercadoLivreApi] ConfigToken não encontrado para refresh.");

  const response = await fetch(configToken.access_token_url!, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: configToken.client_id,
      client_secret: configToken.client_secret,
      refresh_token: configToken.refresh_token,
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `[MercadoLivreApi] Refresh token falhou: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as MercadoLivreTokenResponse;

  await configToken.update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });

  return data.access_token;
};

// Instância do axios para a API do Mercado Livre.
//
// Sem leaky-bucket de rate limit aqui (diferente de blingApi/
// waitForBlingRateLimit) — os limites reais do ML ainda não foram
// confirmados contra a API real (Etapa 1). Se aparecerem 429s no teste
// manual, portar o mesmo padrão de bling_api.service.ts.
export const mercadoLivreApi: AxiosInstance = createAxiosInstance({
  baseURL: "https://api.mercadolibre.com",

  onRequest: async (config) => {
    const configToken = await getMercadoLivreToken();
    config.headers.Authorization = `Bearer ${configToken.access_token}`;
    return config;
  },

  onResponseError: async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    const originalRequest = error.config as
      | (AxiosRequestConfig & { _retry?: boolean })
      | undefined;

    if (
      error.response?.status !== 401 ||
      !originalRequest ||
      originalRequest._retry
    ) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        originalRequest.headers = {
          ...(originalRequest.headers ?? {}),
          Authorization: `Bearer ${token}`,
        };
        return mercadoLivreApi(originalRequest);
      });
    }

    isRefreshing = true;

    try {
      const newToken = await doRefreshToken();
      processQueue(null, newToken);
      originalRequest.headers = {
        ...(originalRequest.headers ?? {}),
        Authorization: `Bearer ${newToken}`,
      };
      return mercadoLivreApi(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError);
      alertService.sendAlert({
        severity: "CRITICAL",
        title: "Mercado Livre API — refresh token falhou",
        message: `Token inválido ou revogado. Sync de collection_date/status de etiqueta parado até reautenticação. Erro: ${refreshError}`,
      });

      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
});

export const handleMercadoLivreOAuthCallback = async (
  code: string,
): Promise<void> => {
  const integration = await getMercadoLivreIntegration();
  const configToken = integration.tokens;

  if (!configToken) throw new Error("ConfigToken não encontrado");

  const tokenRes = await fetch(configToken.access_token_url!, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: configToken.client_id,
      client_secret: configToken.client_secret,
      code,
      redirect_uri: configToken.callback_url!,
    }).toString(),
    signal: AbortSignal.timeout(30_000),
  });

  if (!tokenRes.ok) {
    const errorBody = await tokenRes.text();
    console.log("MercadoLivre error body:", errorBody);
    throw new Error(`Erro ao trocar code: ${tokenRes.status}`);
  }

  const { access_token, refresh_token } =
    (await tokenRes.json()) as MercadoLivreTokenResponse;
  await configToken.update({ access_token, refresh_token });
};
