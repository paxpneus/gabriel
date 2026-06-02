import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { createAxiosInstance } from "../../../../config/axios";
import integrationsService from "../../../integrations/integrations/integrations.service";
import { QueueItem, BlingTokenResponse } from "./bling_api.types";
import ConfigToken from "../../../integrations/config_tokens/config_tokens.model";
import { FullIntegration } from "../../../integrations/integrations/integrations.types";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import { redisConnection } from "../../../../shared/utils/base-models/base-redis";
import { randomUUID } from "crypto";
let isRefreshing = false;
let failedQueue: QueueItem[] = [];

const BLING_RATE_LIMIT_MAX_REQUESTS = Number(
  process.env.BLING_RATE_LIMIT_MAX_REQUESTS ?? 2,
);
const BLING_RATE_LIMIT_WINDOW_MS = Number(
  process.env.BLING_RATE_LIMIT_WINDOW_MS ?? 1000,
);
const BLING_RATE_LIMIT_KEY = "rate-limit:bling:api";
const BLING_429_MAX_RETRIES = Number(process.env.BLING_429_MAX_RETRIES ?? 5);
const BLING_429_BASE_DELAY_MS = Number(
  process.env.BLING_429_BASE_DELAY_MS ?? 3000,
);
const BLING_429_MAX_DELAY_MS = Number(
  process.env.BLING_429_MAX_DELAY_MS ?? 60000,
);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitForBlingRateLimit(): Promise<void> {
  while (true) {
    const now = Date.now();
    const minScore = now - BLING_RATE_LIMIT_WINDOW_MS;
    const member = `${now}:${randomUUID()}`;

    const allowed = await redisConnection.eval(
      `
      redis.call("ZREMRANGEBYSCORE", KEYS[1], "-inf", ARGV[1])
      local count = redis.call("ZCARD", KEYS[1])
      if count < tonumber(ARGV[2]) then
        redis.call("ZADD", KEYS[1], ARGV[3], ARGV[4])
        redis.call("PEXPIRE", KEYS[1], ARGV[5])
        return 1
      end
      redis.call("PEXPIRE", KEYS[1], ARGV[5])
      return 0
      `,
      1,
      BLING_RATE_LIMIT_KEY,
      String(minScore),
      String(BLING_RATE_LIMIT_MAX_REQUESTS),
      String(now),
      member,
      String(BLING_RATE_LIMIT_WINDOW_MS * 2),
    );

    if (Number(allowed) === 1) return;

    await sleep(100);
  }
}

function getRetryAfterMs(retryAfter?: string): number | null {
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

  return null;
}

// Fila em memória para lidar com os requests para a bling. Se caso uma falhar, não tenta enviar vários requests com o token expirado até fazer refresh, guarda todos requests numa fila, executa o refresh, pega o token novo e faz as requisições com o token novo, sem desperdiçar chamadas falhas para a bling
function processQueue(error: unknown, token: string | null = null): void {
  failedQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token!),
  );
  failedQueue = [];
}

// Busca a integração com a bling (options, chave redis para cache)
export const getBlingIntegration = async (
  cacheKey?: string,
): Promise<FullIntegration> => {
  const integration = await integrationsService.getFullIntegration(
    {
      where: {
        name: "Bling",
        type: "SYSTEM",
      },
    },
    cacheKey ? "Bling" : undefined,
  );

  if (!integration) throw new Error("Bling api não encontrada");

  return integration;
};

// Pega o config Token da integração bling
const getBlingToken = async (): Promise<ConfigToken> => {
  const integration = await getBlingIntegration("Bling");

  const token = integration.tokens;

  if (!token) throw new Error("BlingApi Nenhum configToken Encontrado");

  return token;
};

// Renova um token que já existe
export const doRefreshToken = async (): Promise<string> => {
  const integration = await getBlingIntegration();

  const configToken = integration.tokens;
  if (!configToken)
    throw new Error("[BlingApi] ConfigToken não encontrado para refresh.");

  // Bling exige Basic Auth com clientId:clientSecret em Base64
  const basic = Buffer.from(
    `${configToken.client_id}:${configToken.client_secret}`,
  ).toString("base64");

  const response = await fetch(configToken.access_token_url!, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: configToken.refresh_token,
    }).toString(),
  });

  if (!response.ok) {
    throw new Error(
      `[BlingApi] Refresh token falhou: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as BlingTokenResponse;

  // Persiste os novos tokens no banco
  await configToken.update({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
  });

  return data.access_token;
};

// Instancia do axios para bling
export const blingApi: AxiosInstance = createAxiosInstance({
  baseURL: process.env.NODE_ENV == 'development' ? 'nothing' : "https://api.bling.com.br/Api/v3",
  // baseURL: 'http',

  // Interceptor de request: injeta o token atual
  onRequest: async (config) => {
    await waitForBlingRateLimit();
    const configToken = await getBlingToken();
    config.headers.Authorization = `Bearer ${configToken.access_token}`;
    return config;
  },

  // Interceptor de response: trata 401 com refresh automático
  onResponseError: async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    const originalRequest = error.config as AxiosRequestConfig & {
      _retry?: boolean;
      _bling429Retries?: number;
    };

    if (error.response?.status === 429) {
      const attempt = originalRequest._bling429Retries ?? 0;

      if (attempt >= BLING_429_MAX_RETRIES) {
        return Promise.reject(error);
      }

      originalRequest._bling429Retries = attempt + 1;

      const retryAfterMs = getRetryAfterMs(error.response.headers?.["retry-after"]);
      const exponentialDelayMs = Math.min(
        BLING_429_BASE_DELAY_MS * 2 ** attempt,
        BLING_429_MAX_DELAY_MS,
      );
      const delayMs = Math.min(
        retryAfterMs ?? exponentialDelayMs,
        BLING_429_MAX_DELAY_MS,
      );

      console.warn(
        `[BlingApi] 429 rate limit. Tentando novamente em ${Math.ceil(delayMs / 1000)}s (${attempt + 1}/${BLING_429_MAX_RETRIES})`,
      );

      await sleep(delayMs);
      return blingApi(originalRequest);
    }

    // rejeita sem tentar de novo se caso resposta for 401 ou já tentou refresh
    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    // entra na fila e aguarda caso seja um refresh em andamento
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((token) => {
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${token}`;
        }
        return blingApi(originalRequest);
      });
    }

    isRefreshing = true;

    try {
      const newToken = await doRefreshToken();
      processQueue(null, newToken);
      if (originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
      }
      return blingApi(originalRequest);
    } catch (refreshError) {
      processQueue(refreshError);
      alertService.sendAlert({
        severity: "CRITICAL",
        title: "Bling API — refresh token falhou",
        message: `Token inválido ou revogado. Nenhum pedido será processado até reautenticação. Erro: ${refreshError}`,
      });
      return Promise.reject(refreshError);
    } finally {
      isRefreshing = false;
    }
  },
});

export const handleBlingOAuthCallback = async (code: string): Promise<void> => {
  const integration = await getBlingIntegration();
  const configToken = integration.tokens;

  if (!configToken) throw new Error("ConfigToken não encontrado");

  const basic = Buffer.from(
    `${configToken.client_id}:${configToken.client_secret}`,
  ).toString("base64");

  console.log({
    url: configToken.access_token_url,
    client_id: configToken.client_id,
    redirect_uri: configToken.callback_url,
    code,
  });

  const tokenRes = await fetch(configToken.access_token_url!, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: configToken.callback_url!,
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errorBody = await tokenRes.text();
    console.log("Bling error body:", errorBody);
    throw new Error(`Erro ao trocar code: ${tokenRes.status}`);
  }

  const { access_token, refresh_token } =
    (await tokenRes.json()) as BlingTokenResponse;
  await configToken.update({ access_token, refresh_token });
};
