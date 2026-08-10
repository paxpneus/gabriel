import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { createAxiosInstance } from "../../../../../config/axios";
import integrationsService from "../../../../integrations/integrations/integrations.service";
import { QueueItem, SiegTokenResponse } from "./sieg_api.types";
import ConfigToken from "../../../../integrations/config_tokens/config_tokens.model";
import { FullIntegration } from "../../../../integrations/integrations/integrations.types";
import { alertService } from "../../../../../shared/providers/mail-provider/nodemailer.alert";
import { redisConnection } from "../../../../../shared/utils/base-models/base-redis";

let isRefreshing = false;
let failedQueue: QueueItem[] = [];

// Intervalo mínimo entre requests para a Sieg.
// Ajuste conforme o limite real informado pela Sieg (não encontrei doc oficial de rate limit).
const SIEG_RATE_LIMIT_INTERVAL_MS = Number(
  process.env.SIEG_RATE_LIMIT_INTERVAL_MS ?? 500,
);
const SIEG_RATE_LIMIT_KEY = "rate-limit:sieg:next-slot";

const SIEG_429_MAX_RETRIES = Number(process.env.SIEG_429_MAX_RETRIES ?? 5);
const SIEG_429_BASE_DELAY_MS = Number(
  process.env.SIEG_429_BASE_DELAY_MS ?? 3000,
);
const SIEG_429_MAX_DELAY_MS = Number(
  process.env.SIEG_429_MAX_DELAY_MS ?? 60000,
);

// Margem de segurança: renova o JWT um pouco antes do "exp" real bater,
// pra evitar mandar uma request com um token que expira no meio do caminho.
const SIEG_JWT_EXPIRY_BUFFER_MS = Number(
  process.env.SIEG_JWT_EXPIRY_BUFFER_MS ?? 30_000,
);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// Script Lua: reserva atomicamente o próximo slot de horário livre no Redis.
// Cada chamada concorrente pega um slot distinto (now, now+interval, now+2*interval, ...),
// garantindo espaçamento fixo entre requests mesmo com múltiplos processos/instâncias.
const RESERVE_SLOT_SCRIPT = `
  local key = KEYS[1]
  local interval = tonumber(ARGV[1])
  local now = tonumber(ARGV[2])
  local ttl = tonumber(ARGV[3])

  local next_slot = tonumber(redis.call("GET", key))
  if not next_slot or next_slot < now then
    next_slot = now
  end

  redis.call("SET", key, next_slot + interval, "PX", ttl)

  return next_slot
`;

// Enfileira (via sleep) até o horário reservado para essa chamada específica.
async function waitForSiegRateLimit(): Promise<void> {
  const now = Date.now();

  const reservedSlot = Number(
    await redisConnection.eval(
      RESERVE_SLOT_SCRIPT,
      1,
      SIEG_RATE_LIMIT_KEY,
      String(SIEG_RATE_LIMIT_INTERVAL_MS),
      String(now),
      String(SIEG_RATE_LIMIT_INTERVAL_MS * 1000),
    ),
  );

  const delayMs = reservedSlot - now;
  if (delayMs > 0) {
    await sleep(delayMs);
  }
}

// Fila em memória pros requests que chegam enquanto um novo JWT está sendo gerado.
// Evita gerar vários JWTs em paralelo quando várias requests batem token expirado ao mesmo tempo.
function processQueue(error: unknown, token: string | null = null): void {
  failedQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token!),
  );
  failedQueue = [];
}

// Decodifica o payload de um JWT (sem validar assinatura, só pra ler o "exp").
function decodeJwtExpiryMs(jwt: string): number | null {
  try {
    const payloadPart = jwt.split(".")[1];
    if (!payloadPart) return null;

    const payloadJson = Buffer.from(payloadPart, "base64url").toString(
      "utf-8",
    );
    const payload = JSON.parse(payloadJson) as { exp?: number };

    if (!payload.exp) return null;

    return payload.exp * 1000; // "exp" do JWT é em segundos
  } catch {
    // Se não conseguir decodificar, trata como token inválido/expirado
    return null;
  }
}

function isJwtExpired(jwt: string | null | undefined): boolean {
  if (!jwt) return true;

  const expiryMs = decodeJwtExpiryMs(jwt);
  if (expiryMs === null) return true;

  return Date.now() >= expiryMs - SIEG_JWT_EXPIRY_BUFFER_MS;
}

// Busca a integração com a Sieg (options, chave redis para cache)
export const getSiegIntegration = async (
  cacheKey?: string,
): Promise<FullIntegration> => {
  const integration = await integrationsService.getFullIntegration(
    {
      where: {
        name: "Sieg",
        type: "SYSTEM",
      },
    },
    cacheKey ? "Sieg" : undefined,
  );

  if (!integration) throw new Error("Sieg api não encontrada");

  return integration;
};

// Pega o config Token da integração Sieg
const getSiegToken = async (): Promise<ConfigToken> => {
  const integration = await getSiegIntegration("Sieg");

  const token = integration.tokens;

  if (!token) throw new Error("SiegApi Nenhum configToken Encontrado");

  return token;
};

// Gera um novo JWT junto a Sieg usando Client-Id + Secret-Key cadastrados na integração.
// A Sieg exige esses dois valores nos headers da própria request de autenticação
// (não no body) — ajuste os nomes dos headers aqui se o contrato real for diferente.
export const doGenerateJwt = async (): Promise<string> => {
  const integration = await getSiegIntegration();

  const configToken = integration.tokens;
  if (!configToken)
    throw new Error("[SiegApi] ConfigToken não encontrado para gerar JWT.");

  if (!configToken.client_id || !configToken.client_secret) {
    throw new Error(
      "[SiegApi] Client-Id/Secret-Key não configurados na integração.",
    );
  }

  const response = await fetch(configToken.access_token_url!, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Client-Id": configToken.client_id,
      "X-Secret-Key": configToken.client_secret,
    },
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(
      `[SiegApi] Geração de JWT falhou: ${response.status} ${response.statusText}`,
    );
  }

  const data = (await response.json()) as SiegTokenResponse;

  if (!data.jwt) {
    throw new Error("[SiegApi] Resposta de autenticação sem JWT.");
  }

  // Persiste o novo JWT no banco, reaproveitando o campo access_token
  await configToken.update({
    access_token: data.jwt,
  });

  return data.jwt;
};

// Garante que existe um JWT válido, gerando um novo se necessário/expirado.
// Usa a mesma fila da Bling pra não gerar vários JWTs em paralelo.
async function ensureValidJwt(configToken: ConfigToken): Promise<string> {
  if (!isJwtExpired(configToken.access_token)) {
    return configToken.access_token!;
  }

  if (isRefreshing) {
    return new Promise<string>((resolve, reject) => {
      failedQueue.push({ resolve, reject });
    });
  }

  isRefreshing = true;

  try {
    const newJwt = await doGenerateJwt();
    processQueue(null, newJwt);
    return newJwt;
  } catch (generateError) {
    processQueue(generateError);
    alertService.sendAlert({
      severity: "CRITICAL",
      title: "Sieg API — geração de JWT falhou",
      message: `ApiKey inválida ou endpoint indisponível. Nenhum pedido será processado até correção. Erro: ${generateError}`,
    });

    throw generateError;
  } finally {
    isRefreshing = false;
  }
}

// Instancia do axios para a Sieg
export const siegApi: AxiosInstance = createAxiosInstance({
  baseURL:
    process.env.NODE_ENV ?? "https://api.sieg.com/api",

  // Interceptor de request: garante JWT válido e injeta os dois headers exigidos pela Sieg
  onRequest: async (config) => {
    await waitForSiegRateLimit();
    const configToken = await getSiegToken();
    const jwt = await ensureValidJwt(configToken);

    config.headers.Authorization = `Bearer ${jwt}`;
    config.headers["X-Api-Key"] = configToken.api_key;

    return config;
  },

  // Interceptor de response: trata 401 gerando um novo JWT (fallback de segurança,
  // já que o request idealmente nem deveria sair com JWT expirado por causa do onRequest)
  onResponseError: async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    const originalRequest = error.config as AxiosRequestConfig & {
      _retry?: boolean;
      _sieg429Retries?: number;
    };

    if (error.response?.status === 429) {
      const attempt = originalRequest._sieg429Retries ?? 0;

      if (attempt >= SIEG_429_MAX_RETRIES) {
        return Promise.reject(error);
      }

      originalRequest._sieg429Retries = attempt + 1;

      const retryAfterMs = getRetryAfterMs(
        error.response.headers?.["retry-after"],
      );
      const exponentialDelayMs = Math.min(
        SIEG_429_BASE_DELAY_MS * 2 ** attempt,
        SIEG_429_MAX_DELAY_MS,
      );
      const delayMs = Math.min(
        retryAfterMs ?? exponentialDelayMs,
        SIEG_429_MAX_DELAY_MS,
      );

      console.warn(
        `[SiegApi] 429 rate limit. Tentando novamente em ${Math.ceil(delayMs / 1000)}s (${attempt + 1}/${SIEG_429_MAX_RETRIES})`,
      );

      await sleep(delayMs);
      return siegApi(originalRequest);
    }

    // rejeita sem tentar de novo se caso resposta for 401 ou já tentou regenerar o JWT
    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    // entra na fila e aguarda caso já exista uma geração de JWT em andamento
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        failedQueue.push({ resolve, reject });
      }).then((jwt) => {
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${jwt}`;
        }
        return siegApi(originalRequest);
      });
    }

    isRefreshing = true;

    try {
      const newJwt = await doGenerateJwt();
      processQueue(null, newJwt);
      if (originalRequest.headers) {
        originalRequest.headers.Authorization = `Bearer ${newJwt}`;
      }
      return siegApi(originalRequest);
    } catch (generateError) {
      processQueue(generateError);
      alertService.sendAlert({
        severity: "CRITICAL",
        title: "Sieg API — geração de JWT falhou (401)",
        message: `ApiKey inválida ou revogada. Nenhum pedido será processado até correção. Erro: ${generateError}`,
      });

      return Promise.reject(generateError);
    } finally {
      isRefreshing = false;
    }
  },
});

function getRetryAfterMs(retryAfter?: string): number | null {
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

  return null;
}