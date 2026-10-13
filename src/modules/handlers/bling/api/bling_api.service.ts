import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { createAxiosInstance } from "../../../../config/axios";
import integrationsService from "../../../integrations/integrations/integrations.service";
import { QueueItem, BlingTokenResponse } from "./bling_api.types";
import ConfigToken from "../../../integrations/config_tokens/config_tokens.model";
import { FullIntegration } from "../../../integrations/integrations/integrations.types";
import { alertService } from "../../../../shared/providers/mail-provider/nodemailer.alert";
import { redisConnection } from "../../../../shared/utils/base-models/base-redis";
import {
  jobContext,
  sleepUnlessJobAborted,
  throwIfJobAborted,
  trackRateLimitWait,
} from "../../../../shared/utils/base-models/job-context";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { REDIS_SCRIPTS_DIR } from "../../../../config/resource-paths";
import {
  BLING_DEFAULT_LANE,
  BLING_LANE_DEFAULT_WEIGHT,
  BLING_LANE_WEIGHTS,
  BLING_STRICT_LANES,
} from "./bling-rate-limit-lanes";

let isRefreshing = false;
let failedQueue: QueueItem[] = [];

// Intervalo mínimo entre requests para a Bling (default: 2000ms = 0.5 req/s).
// A Bling permite até 3 req/s, mas mesmo a 1000ms e depois 1500ms o 429
// continuou ocorrendo com frequência — aumentado pra 2000ms de margem extra.
// Esse limiter cobre toda chamada que passa pela instância `blingApi`
// (GET/POST/PUT/PATCH/DELETE, via onRequest abaixo) mais os dois scrapers
// autenticados por cookie que chamam waitForBlingRateLimit() manualmente
// (get-stock-movements.ts, nfe-manifest-web-scraping.service.ts) — a conta
// Bling tem uma cota só, não por app/token (ver comentário na exportação
// abaixo). Se o 429 persistir mesmo com essa margem, o suspeito deixa de
// ser o pacing e passa a ser: (a) tráfego fora deste processo — outro
// deploy/ambiente ou script manual apontando pra um Redis diferente do de
// produção, que não compartilha a chave BLING_RATE_LIMIT_KEY; ou (b) um
// bloqueio de IP de 10-60min já em andamento (300 erros/10s ou 600
// requests/10s), que faz TODA chamada falhar até o bloqueio expirar,
// mesmo com o pacing correto — nesse caso o log de erro é enganoso porque
// parece "estourando toda hora" quando na verdade é um único banimento
// persistente.
const BLING_RATE_LIMIT_INTERVAL_MS = Number(
  process.env.BLING_RATE_LIMIT_INTERVAL_MS ?? 2000,
);
const BLING_RATE_LIMIT_KEY = "rate-limit:bling:last-dispatch-at";
const BLING_LANE_STATE_KEY = "rate-limit:bling:lane-state";
const BLING_ACTIVE_LANES_KEY = "rate-limit:bling:active-lanes";
const BLING_ALIVE_TICKETS_KEY = "rate-limit:bling:alive-tickets";
const BLING_LANE_KEY_PREFIX = "rate-limit:bling:lane:";
const BLING_TICKET_STALE_MS = 15_000;
const BLING_CLAIM_TIMEOUT_MS = 5_000;
const BLING_CLAIM_POLL_MS = 50;

const BLING_429_MAX_RETRIES = Number(process.env.BLING_429_MAX_RETRIES ?? 5);
const BLING_429_BASE_DELAY_MS = Number(
  process.env.BLING_429_BASE_DELAY_MS ?? 3000,
);
const BLING_429_MAX_DELAY_MS = Number(
  process.env.BLING_429_MAX_DELAY_MS ?? 60000,
);

// Check-and-claim atômico com faixas — lógica comentada no próprio .lua.
const FAIR_DISPATCH_SCRIPT = fs.readFileSync(
  path.join(REDIS_SCRIPTS_DIR, "bling-fair-dispatch.lua"),
  "utf8",
);

// Contador diagnóstico: incrementa atomicamente quantas requisições REAIS
// (pós rate-limit, já prontas pra sair) saíram pra Bling no segundo corrente.
// Chave em Redis (não em memória) pra contar certo mesmo com múltiplos
// processos (worker-bling, worker-automation, etc.) batendo na mesma conta.
const INCR_REQUEST_COUNT_SCRIPT = `
  local key = KEYS[1]
  local ttl = tonumber(ARGV[1])
  local count = redis.call("INCR", key)
  redis.call("PEXPIRE", key, ttl)
  return count
`;
const BLING_REQUEST_COUNT_KEY_PREFIX = "rate-limit:bling:req-count:";

// GETSET atômico só pra log: devolve o timestamp do disparo anterior (de
// QUALQUER processo) enquanto grava o atual, pra logar o gap real entre
// disparos consecutivos — é essa métrica, não a contagem por segundo
// sozinha, que confirma se o FAIR_DISPATCH_SCRIPT não deixa passar
// rajadas (gap sempre >= BLING_RATE_LIMIT_INTERVAL_MS mesmo com várias
// filas rodando juntas). Chave separada da usada pelo rate limiter em si
// — isto é só observabilidade, nunca deve influenciar se uma chamada é
// liberada ou não.
const BLING_LAST_DISPATCH_LOG_KEY = "rate-limit:bling:last-dispatch-log";

// Loga quantas requisições já saíram pra Bling neste segundo, e o gap real
// desde o disparo anterior — usado pra diagnosticar 429 (confirmar
// visualmente a taxa/espaçamento real de saída, já que o limiter é um
// mecanismo global via Redis, não algo fácil de observar direto). Remover
// depois que o diagnóstico do rate-limit for concluído.
async function logOutgoingBlingRequestRate(
  now: number,
  lane: string,
): Promise<void> {
  const second = Math.floor(now / 1000);
  const countKey = `${BLING_REQUEST_COUNT_KEY_PREFIX}${second}`;

  const [count, previousDispatchAt] = await Promise.all([
    redisConnection.eval(INCR_REQUEST_COUNT_SCRIPT, 1, countKey, "10000"),
    redisConnection.getset(BLING_LAST_DISPATCH_LOG_KEY, String(now)),
  ]);
  await redisConnection.pexpire(BLING_LAST_DISPATCH_LOG_KEY, 10 * 60 * 1000);

  const gapMs = previousDispatchAt ? now - Number(previousDispatchAt) : null;

  console.log(
    `[BlingApi][ReqCounter] ${new Date(now).toISOString()} — requisição #${count} neste segundo (epoch=${second}, faixa=${lane})` +
      (gapMs !== null ? `, gap desde a anterior=${gapMs}ms` : ", primeira chamada registrada"),
  );
}

// Espera registrada no jobContext pra não contar no maxProcessingMs do job.
export function waitForBlingRateLimit(): Promise<void> {
  return trackRateLimitWait(waitForBlingSlot);
}

// Loop de check-and-claim: dorme o que o script mandar e reconfere no Redis (nunca confia que o sleep foi preciso).
// O heartbeat do ticket é cada chamada ao script — por isso nenhuma espera passa de `interval`/pollMs.
async function waitForBlingSlot(): Promise<void> {
  const context = jobContext.getStore();
  const lane = context?.lane ?? BLING_DEFAULT_LANE;
  const score = context?.enqueuedAt ?? Date.now();
  const ticket = randomUUID();

  try {
    while (true) {
      // Job que estourou maxProcessingMs não pega vaga nova — requisição já em andamento termina (POST de NF-e não pode ser cortado no meio).
      throwIfJobAborted();
      const now = Date.now();

      const waitMs = Number(
        await redisConnection.eval(
          FAIR_DISPATCH_SCRIPT,
          4,
          BLING_RATE_LIMIT_KEY,
          BLING_LANE_STATE_KEY,
          BLING_ACTIVE_LANES_KEY,
          BLING_ALIVE_TICKETS_KEY,
          ticket,
          lane,
          String(score),
          String(now),
          String(BLING_RATE_LIMIT_INTERVAL_MS),
          String(BLING_TICKET_STALE_MS),
          String(BLING_CLAIM_TIMEOUT_MS),
          String(BLING_CLAIM_POLL_MS),
          BLING_LANE_KEY_PREFIX,
          String(BLING_LANE_DEFAULT_WEIGHT),
          JSON.stringify(BLING_LANE_WEIGHTS),
          JSON.stringify(BLING_STRICT_LANES),
        ),
      );

      if (waitMs <= 0) {
        await logOutgoingBlingRequestRate(now, lane);
        return;
      }

      await sleepUnlessJobAborted(waitMs);
    }
  } catch (error) {
    await Promise.all([
      redisConnection.zrem(BLING_ALIVE_TICKETS_KEY, ticket),
      redisConnection.zrem(`${BLING_LANE_KEY_PREFIX}${lane}`, ticket),
    ]).catch(() => {});
    throw error;
  }
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
      "enable-jwt": "1",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: configToken.refresh_token,
    }).toString(),
      signal: AbortSignal.timeout(30_000),
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
  // Bling desativa tokens opacos em 15/10; sem este header a API para de aceitar as requisições
  headers: {
    "enable-jwt": "1",
  },

  // Interceptor de request: injeta o token atual
  onRequest: async (config) => {
    const method = config.method?.toUpperCase();
    const isMutatingMethod =
      !!method && ["POST", "PUT", "PATCH", "DELETE"].includes(method);

    // Bloqueia requests de escrita para a Bling fora de produção, evitando
    // alterar dados reais na API durante desenvolvimento/testes.
    if (isMutatingMethod && process.env.NODE_ENV !== "production") {
      throw new Error(
        `[BlingApi] Requisição ${method} bloqueada: NODE_ENV="${process.env.NODE_ENV}" (apenas em "production" a Bling aceita requests de escrita).`,
      );
    }

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

      await trackRateLimitWait(() => sleepUnlessJobAborted(delayMs));
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
      "enable-jwt": "1",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: configToken.callback_url!,
    }).toString(),
    signal: AbortSignal.timeout(30_000),
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

function getRetryAfterMs(retryAfter?: string): number | null {
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

  return null;
}