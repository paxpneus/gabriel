import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import https from "https";
import { createAxiosInstance } from "../../../../config/axios";
import { QueueItem, TCarBranchSession, TCarLoginResponse } from "./tecinco_api.types";
import integrationsService from "../../../integrations/integrations/integrations.service";
import { FullIntegration } from "../../../integrations/integrations/integrations.types";

// ---------------------------------------------------------------------------
// Credenciais — via integrationsService igual à Bling
// ---------------------------------------------------------------------------

export const getTCarIntegration = async (
  cacheKey?: string,
): Promise<FullIntegration> => {
  const integration = await integrationsService.getFullIntegration(
    {
      where: {
        name: 'Tecinco',
        type: 'SYSTEM',
      },
    },
    cacheKey ? 'Tecinco' : undefined,
  );

  if (!integration) throw new Error('[TCarApi] Integração "Tecinco" não encontrada.');

  return integration;
};

const getTCarToken = async () => {
  const integration = await getTCarIntegration('Tecinco');

  const token = integration.tokens;

  if (!token) throw new Error('[TCarApi] ConfigToken da integração Tecinco não encontrado.');
  if (!token.api_key) throw new Error('[TCarApi] api_key ausente no ConfigToken Tecinco.');
  if (!token.username) throw new Error('[TCarApi] username ausente no ConfigToken Tecinco.');

  return {
    baseUrl: integration.api_url,
    apiKey: token.api_key,
    username: token.username,
    password: process.env.TCAR_PASSWORD ?? '',
    companyId: Number(process.env.TCAR_COMPANY_ID ?? '0'),
  };
};

// ---------------------------------------------------------------------------
// TLS
// ---------------------------------------------------------------------------

const httpsAgent =
  process.env.TCAR_TLS_REJECT_UNAUTHORIZED === 'false'
    ? new https.Agent({ rejectUnauthorized: false })
    : undefined;

// ---------------------------------------------------------------------------
// Rate limit
// ---------------------------------------------------------------------------

const TCAR_429_MAX_RETRIES = Number(process.env.TCAR_429_MAX_RETRIES   ?? 5);
const TCAR_429_BASE_DELAY  = Number(process.env.TCAR_429_BASE_DELAY_MS ?? 2000);
const TCAR_429_MAX_DELAY   = Number(process.env.TCAR_429_MAX_DELAY_MS  ?? 60000);

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
  const { baseUrl, apiKey, username, password, companyId } = await getTCarToken();

  const axiosInstance = axios.create({
    baseURL: baseUrl,
    ...(httpsAgent ? { httpsAgent } : {}),
  });

  const loginRes = await axiosInstance.post(
    `/auth/login`,
    { username, password },
    {
      params: { company_id: companyId },
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
    },
  );

  const body = loginRes.data as TCarLoginResponse;

  if (body.status !== 'success') {
    throw new Error(
      `[TCarApi] Login rejeitado (branch ${branchId}): ${JSON.stringify(body)}`,
    );
  }

  const { session_token, branch_required } = body.data;

  if (branch_required) {
    await axiosInstance.post(
      `/auth/session/branch`,
      { branch_id: branchId },
      {
        params: { company_id: companyId },
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'x-tcar-session': session_token,
        },
      },
    );
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
// Instância Axios
// ---------------------------------------------------------------------------

export const tcarApi: AxiosInstance = createAxiosInstance({
  baseURL: 'http://placeholder',
  ...(httpsAgent ? { httpsAgent } : {}),

   onResponse: (response) => {
    if (typeof response.data === 'string') {
      try {
        const fixed = response.data.replace(
          /:\s*(\d+),(\d{2})([,\}\]])/g,
          ': $1.$2$3',
        );
        response.data = JSON.parse(fixed);
      } catch (e) {
      }
    }
    return response;
  },

  onRequest: async (config) => {
    const { baseUrl, apiKey, companyId } = await getTCarToken();

    const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const url  = new URL(config.url ?? '', base);

    if (!url.searchParams.has('company_id')) {
      url.searchParams.set('company_id', String(companyId));
    }

    const branchId = Number(url.searchParams.get('branch_id') ?? '0');

    if (!branchId) {
      throw new Error(
        '[TCarApi] branch_id ausente na requisição. Use tcarRequest(branchId, ...) ou passe ?branch_id= na URL.',
      );
    }

    const token = await ensureSession(branchId);

    config.headers['x-api-key']      = apiKey;
    config.headers['x-tcar-session'] = token;
    config.url    = url.pathname + url.search;
    config.baseURL = baseUrl;

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

      const retryAfter    = error.response.headers?.['retry-after'];
      const retryAfterMs  = retryAfter ? Number(retryAfter) * 1000 : null;
      const exponentialMs = Math.min(TCAR_429_BASE_DELAY * 2 ** attempt, TCAR_429_MAX_DELAY);
      const delayMs       = Math.min(retryAfterMs ?? exponentialMs, TCAR_429_MAX_DELAY);

      console.warn(
        `[TCarApi] 429 rate limit. Retentando em ${Math.ceil(delayMs / 1000)}s (${attempt + 1}/${TCAR_429_MAX_RETRIES})`,
      );

      await sleep(delayMs);
      return tcarApi(originalRequest);
    }

    // 401 — sessão expirada
    if (error.response?.status !== 401 || originalRequest._retry) {
      return Promise.reject(error);
    }

    originalRequest._retry = true;

    const { baseUrl } = await getTCarToken();
    const base        = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const url         = new URL(originalRequest.url ?? '', base);
    const branchId    = Number(url.searchParams.get('branch_id') ?? '0');

    const session = getSession(branchId);
    session.sessionToken = null;

    if (session.isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        session.failedQueue.push({ resolve, reject });
      }).then((token) => {
        if (originalRequest.headers) {
          originalRequest.headers['x-tcar-session'] = token;
        }
        return tcarApi(originalRequest);
      });
    }

    session.isRefreshing = true;

    try {
      const newToken = await doTCarLogin(branchId);
      processQueue(session, null, newToken);

      if (originalRequest.headers) {
        originalRequest.headers['x-tcar-session'] = newToken;
      }
      return tcarApi(originalRequest);
    } catch (loginError) {
      processQueue(session, loginError);
      console.error(`[TCarApi] Re-login falhou para branch ${branchId}.`, loginError);
      return Promise.reject(loginError);
    } finally {
      session.isRefreshing = false;
    }
  },
});

// ---------------------------------------------------------------------------
// Helper recomendado — injeta branch_id automaticamente
// ---------------------------------------------------------------------------

export async function tcarRequest<T>(
  branchId: number,
  fn: (api: AxiosInstance) => Promise<T>,
): Promise<T> {
  const { baseUrl, companyId } = await getTCarToken();

  const scoped = axios.create({ baseURL: baseUrl, ...(httpsAgent ? { httpsAgent } : {}), });

  scoped.interceptors.request  = tcarApi.interceptors.request  as typeof scoped.interceptors.request;
  scoped.interceptors.response = tcarApi.interceptors.response as typeof scoped.interceptors.response;

  // Injeta como params padrão E como transformRequest para garantir que
  // o interceptor já encontre na URL antes de processar
  scoped.defaults.params = {
    ...scoped.defaults.params,
    company_id: companyId,
    branch_id: branchId,
  };

  // Cria um adapter que força os params na URL antes do interceptor rodar
  scoped.interceptors.request.use((config) => {
    const url = new URL(config.url ?? '', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    if (!url.searchParams.has('branch_id')) {
      url.searchParams.set('branch_id', String(branchId));
    }
    if (!url.searchParams.has('company_id')) {
      url.searchParams.set('company_id', String(companyId));
    }
    config.url = url.pathname + url.search;
    return config;
  }, undefined, { runWhen: () => true });

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
  const { baseUrl, apiKey, companyId } = await getTCarToken();

  const session = sessionPool.get(branchId);
  if (!session?.sessionToken) return;

  try {
    const axiosInstance = axios.create({
      baseURL: baseUrl,
      ...(httpsAgent ? { httpsAgent } : {}),
    });

    await axiosInstance.post(
      `/auth/logout`,
      {},
      {
        params: { company_id: companyId },
        headers: {
          'x-api-key': apiKey,
          'x-tcar-session': session.sessionToken,
        },
      },
    );
  } finally {
    session.sessionToken = null;
  }
}