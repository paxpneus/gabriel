import axios, { AxiosInstance, AxiosRequestConfig, InternalAxiosRequestConfig } from "axios";
import { createAxiosInstance } from "../../../../../../config/axios";
import integrationsService from "../../../../../integrations/integrations/integrations.service";
import ConfigToken from "../../../../../integrations/config_tokens/config_tokens.model";
import { FullIntegration } from "../../../../../integrations/integrations/integrations.types";
import { alertService } from "../../../../../../shared/providers/mail-provider/nodemailer.alert";


// ─── Constants ────────────────────────────────────────────────────────────────

export const JADLOG_BASE_URL = "https://www.jadlog.com.br/embarcador/api";
export const JADLOG_TRACKING_URL = "https://prd-traffic.jadlogtech.com.br/embarcador/api";
export const JADLOG_PICKUP_URL = "https://www.jadlog.com.br/pickup";
export const JADLOG_QRCODE_URL = "https://www.jadlog.com.br/qrcodeservice/api";

const JADLOG_RETRY_MAX = Number(process.env.JADLOG_RETRY_MAX ?? 3);
const JADLOG_RETRY_BASE_DELAY_MS = Number(process.env.JADLOG_RETRY_BASE_DELAY_MS ?? 2000);
const JADLOG_RETRY_MAX_DELAY_MS = Number(process.env.JADLOG_RETRY_MAX_DELAY_MS ?? 30000);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ─── Integration helpers ──────────────────────────────────────────────────────

export const getJadlogIntegration = async (
  cacheKey?: string,
): Promise<FullIntegration> => {
  const integration = await integrationsService.getFullIntegration(
    { where: { name: "Jadlog", type: "SYSTEM" } },
    cacheKey ? "Jadlog" : undefined,
  );

  if (!integration) throw new Error("[JadlogApi] Integração Jadlog não encontrada.");

  return integration;
};

export const getJadlogToken = async (): Promise<ConfigToken> => {
  const integration = await getJadlogIntegration("Jadlog");
  const token = integration.tokens;

  if (!token) throw new Error("[JadlogApi] Nenhum ConfigToken encontrado.");

  return token;
};

// ─── Shared interceptors ──────────────────────────────────────────────────────

const buildRequestInterceptor =
  () =>
  async (config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> => {
    const configToken = await getJadlogToken();
    config.headers.Authorization = `Bearer ${configToken.access_token}`;
    return config;
  };

const buildResponseErrorInterceptor =
  (getInstance: () => AxiosInstance) => async (error: unknown) => {
    if (!axios.isAxiosError(error)) return Promise.reject(error);

    const originalRequest = error.config as AxiosRequestConfig & {
      _jadlogRetries?: number;
    };

    const status = error.response?.status;
    const isRetryable = status === 429 || (status !== undefined && status >= 500);

    if (isRetryable) {
      const attempt = originalRequest._jadlogRetries ?? 0;

      if (attempt >= JADLOG_RETRY_MAX) {
        alertService.sendAlert({
          severity: "HIGH",
          title: "Jadlog API — máximo de retries atingido",
          message: `Status ${status} após ${JADLOG_RETRY_MAX} tentativas. URL: ${originalRequest.url}`,
        });
        return Promise.reject(error);
      }

      originalRequest._jadlogRetries = attempt + 1;

      const retryAfterHeader = error.response?.headers?.["retry-after"];
      const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
      const exponentialMs = Math.min(
        JADLOG_RETRY_BASE_DELAY_MS * 2 ** attempt,
        JADLOG_RETRY_MAX_DELAY_MS,
      );
      const delayMs = retryAfterMs ?? exponentialMs;

      console.warn(
        `[JadlogApi] HTTP ${status}. Retry em ${Math.ceil(delayMs / 1000)}s (${attempt + 1}/${JADLOG_RETRY_MAX}). URL: ${originalRequest.url}`,
      );

      await sleep(delayMs);
      return getInstance()(originalRequest);
    }

    // Token Jadlog é estático — 401 exige renovação manual junto ao comercial
    if (status === 401) {
      alertService.sendAlert({
        severity: "CRITICAL",
        title: "Jadlog API — token inválido ou expirado",
        message:
          "A requisição retornou 401. O token Jadlog deve ser renovado junto à franquia/comercial Jadlog.",
      });
    }

    return Promise.reject(error);
  };

// ─── Axios instances ──────────────────────────────────────────────────────────

/** Pedidos, frete, CT-e, tratativas */
export const jadlogApi: AxiosInstance = createAxiosInstance({
  baseURL: process.env.NODE_ENV === "development" ? "nothing" : JADLOG_BASE_URL,
  onRequest: buildRequestInterceptor(),
  onResponseError: buildResponseErrorInterceptor(() => jadlogApi),
});

/** Tracking completo e simples (domínio diferente) */
export const jadlogTrackingApi: AxiosInstance = createAxiosInstance({
  baseURL: process.env.NODE_ENV === "development" ? "nothing" : JADLOG_TRACKING_URL,
  onRequest: buildRequestInterceptor(),
  onResponseError: buildResponseErrorInterceptor(() => jadlogTrackingApi),
});

/** Consulta de Pickup Points / PUDOs */
export const jadlogPickupApi: AxiosInstance = createAxiosInstance({
  baseURL: process.env.NODE_ENV === "development" ? "nothing" : JADLOG_PICKUP_URL,
  onRequest: buildRequestInterceptor(),
  onResponseError: buildResponseErrorInterceptor(() => jadlogPickupApi),
});