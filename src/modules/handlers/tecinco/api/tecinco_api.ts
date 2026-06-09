import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import https from "https";
import { createAxiosInstance } from "../../../../config/axios";
import { QueueItem, TCarBranchSession, TCarLoginResponse } from "./tecinco_api.types";

// ---------------------------------------------------------------------------
// Configuração via env
// ---------------------------------------------------------------------------

const BASE_URL   = process.env.TCAR_API_URL    ?? "http://localhost:8080";
const API_KEY    = process.env.TCAR_API_KEY    ?? "";
const COMPANY_ID = Number(process.env.TCAR_COMPANY_ID ?? "0");
const USERNAME   = process.env.TCAR_USERNAME   ?? "";
const PASSWORD   = process.env.TCAR_PASSWORD   ?? "";

const TCAR_429_MAX_RETRIES = Number(process.env.TCAR_429_MAX_RETRIES   ?? 5);
const TCAR_429_BASE_DELAY  = Number(process.env.TCAR_429_BASE_DELAY_MS ?? 2000);
const TCAR_429_MAX_DELAY   = Number(process.env.TCAR_429_MAX_DELAY_MS  ?? 60000);

const httpsAgent =
  process.env.TCAR_TLS_REJECT_UNAUTHORIZED === "false"
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

// ---------------------------------------------------------------------------
// Pool de sessões — uma entrada por branch_id, criada sob demanda
// ---------------------------------------------------------------------------

const sessionPool = new Map<number, TCarBranchSession>();

function getSession(branchId: number): TCarBranchSession {
  if (!sessionPool.has(branchId)) {
    sessionPool.set(branchId, { sessionToken: null, isRefreshing: false, failedQueue: [] });
  }
  return sessionPool.get(branchId)!;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processQueue(session: TCarBranchSession, error: unknown, token: string | null = null): void {
  session.failedQueue.forEach(({ resolve, reject }) =>
    error ? reject(error) : resolve(token!),
  );
  session.failedQueue = [];
}

// ---------------------------------------------------------------------------
// Login por filial
// ---------------------------------------------------------------------------

export async function doTCarLogin(branchId: number): Promise<string> {
  const loginRes = await fetch(`${BASE_URL}/auth/login?company_id=${COMPANY_ID}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    ...(httpsAgent ? { agent: httpsAgent } : {}),
  });

  if (!loginRes.ok) {
    throw new Error(
      `[TCarApi] Login falhou para branch ${branchId}: ${loginRes.status} ${loginRes.statusText}`,
    );
  }

  const body = (await loginRes.json()) as TCarLoginResponse;

  if (body.status !== "success") {
    throw new Error(
      `[TCarApi] Login rejeitado (branch ${branchId}): ${JSON.stringify(body)}`,
    );
  }

  const { session_token, branch_required } = body.data;

  if (branch_required) {
    const branchRes = await fetch(
      `${BASE_URL}/auth/session/branch?company_id=${COMPANY_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": API_KEY,
          "x-tcar-session": session_token,
        },
        body: JSON.stringify({ branch_id: branchId }),
        ...(httpsAgent ? { agent: httpsAgent } : {}),
      },
    );

    if (!branchRes.ok) {
      throw new Error(
        `[TCarApi] Seleção de filial ${branchId} falhou: ${branchRes.status} ${branchRes.statusText}`,
      );
    }
  }

  getSession(branchId).sessionToken = session_token;
  return session_token;
}

// ---------------------------------------------------------------------------
// Garante sessão ativa para uma filial, serializando logins concorrentes
// ---------------------------------------------------------------------------

async function ensureSession(branchId: number): Promise<string> {
  const session = getSession(branchId);

  if (session.sessionToken) return session.sessionToken;

  if (session.isRefreshing) {
    return new Promise<string>((resolve, reject) => {
      session.failedQueue.push({ resolve, reject });
    });
  }

  session.isRefreshing = true;
  try {
    const token = await doTCarLogin(branchId);
    processQueue(session, null, token);
    return token;
  } catch (err) {
    processQueue(session, err);
    throw err;
  } finally {
    session.isRefreshing = false;
  }
}

// ---------------------------------------------------------------------------
// Instância única do Axios
//
// branch_id é obrigatório em toda requisição de negócio. Passe-o sempre via
// query string ou use o helper tcarRequest() abaixo que injeta automaticamente.
//
// Os interceptors resolvem a sessão correta pelo branch_id presente na URL,
// então uma única instância serve todas as 23 filiais sem custo extra.
// ---------------------------------------------------------------------------

export const tcarApi: AxiosInstance = createAxiosInstance({
  baseURL: BASE_URL,
  ...(httpsAgent ? { httpsAgent } : {}),

  onRequest: async (config) => {
    // Lê o branch_id que já deve estar na URL ou nos params do config
    const base   = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`;
    const url    = new URL(config.url ?? "", base);

    // Garante company_id
    if (!url.searchParams.has("company_id")) {
      url.searchParams.set("company_id", String(COMPANY_ID));
    }

    const branchId = Number(url.searchParams.get("branch_id") ?? "0");

    if (!branchId) {
      throw new Error(
        "[TCarApi] branch_id ausente na requisição. Use tcarRequest(branchId, ...) ou passe ?branch_id= na URL.",
      );
    }

    const token = await ensureSession(branchId);

    config.headers["x-api-key"]      = API_KEY;
    config.headers["x-tcar-session"] = token;
    config.url = url.pathname + url.search;

    return config;
  },

  onResponseError: async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    const originalRequest = error.config as AxiosRequestConfig & {
      _retry?: boolean;
      _tcar429Retries?: number;
    };

    // 429 — back-off exponencial
    if (error.response?.status === 429) {
      const attempt = originalRequest._tcar429Retries ?? 0;
      if (attempt >= TCAR_429_MAX_RETRIES) return Promise.reject(error);

      originalRequest._tcar429Retries = attempt + 1;

      const retryAfter    = error.response.headers?.["retry-after"];
      const retryAfterMs  = retryAfter ? Number(retryAfter) * 1000 : null;
      const exponentialMs = Math.min(TCAR_429_BASE_DELAY * 2 ** attempt, TCAR_429_MAX_DELAY);
      const delayMs       = Math.min(retryAfterMs ?? exponentialMs, TCAR_429_MAX_DELAY);

      console.warn(
        `[TCarApi] 429 rate limit. Retentando em ${Math.ceil(delayMs / 1000)}s (${attempt + 1}/${TCAR_429_MAX_RETRIES})`,
      );

      await sleep(delayMs);
      return tcarApi(originalRequest);
    }

    // 401 — sessão expirada: invalida e refaz login para a filial correta
    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    // Extrai branch_id da URL original para invalidar a sessão certa
    const base     = BASE_URL.endsWith("/") ? BASE_URL : `${BASE_URL}/`;
    const url      = new URL(originalRequest.url ?? "", base);
    const branchId = Number(url.searchParams.get("branch_id") ?? "0");

    const session = getSession(branchId);
    session.sessionToken = null;

    if (session.isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        session.failedQueue.push({ resolve, reject });
      }).then((token) => {
        if (originalRequest.headers) {
          originalRequest.headers["x-tcar-session"] = token;
        }
        return tcarApi(originalRequest);
      });
    }

    session.isRefreshing = true;

    try {
      const newToken = await doTCarLogin(branchId);
      processQueue(session, null, newToken);

      if (originalRequest.headers) {
        originalRequest.headers["x-tcar-session"] = newToken;
      }
      return tcarApi(originalRequest);
    } catch (loginError) {
      processQueue(session, loginError);
      console.error(
        `[TCarApi] Re-login falhou para branch ${branchId}.`,
        loginError,
      );
      return Promise.reject(loginError);
    } finally {
      session.isRefreshing = false;
    }
  },
});

// ---------------------------------------------------------------------------
// Helper recomendado — injeta branch_id automaticamente
//
// Uso:
//   const clientes = await tcarRequest(1, api => api.get("/clientes"));
//   const os       = await tcarRequest(2, api => api.get("/ordens-servico"));
// ---------------------------------------------------------------------------

export async function tcarRequest<T>(
  branchId: number,
  fn: (api: AxiosInstance) => Promise<T>,
): Promise<T> {
  // Cria uma instância derivada com branch_id fixo nos params padrão
  const scoped = axios.create({ baseURL: BASE_URL });

  // Copia interceptors do tcarApi
  scoped.interceptors.request  = tcarApi.interceptors.request  as typeof scoped.interceptors.request;
  scoped.interceptors.response = tcarApi.interceptors.response as typeof scoped.interceptors.response;

  // Fixa branch_id como default param para todas as chamadas dessa closure
  scoped.defaults.params = {
    ...scoped.defaults.params,
    company_id: COMPANY_ID,
    branch_id: branchId,
  };

  return fn(scoped);
}

// ---------------------------------------------------------------------------
// Utilitários de sessão
// ---------------------------------------------------------------------------

export function invalidateTCarSession(branchId: number): void {
  const session = sessionPool.get(branchId);
  if (session) session.sessionToken = null;
}

export async function tcarLogout(branchId: number): Promise<void> {
  const session = sessionPool.get(branchId);
  if (!session?.sessionToken) return;

  try {
    await fetch(`${BASE_URL}/auth/logout?company_id=${COMPANY_ID}`, {
      method: "POST",
      headers: {
        "x-api-key": API_KEY,
        "x-tcar-session": session.sessionToken,
      },
      ...(httpsAgent ? { agent: httpsAgent } : {}),
    });
  } finally {
    session.sessionToken = null;
  }
}