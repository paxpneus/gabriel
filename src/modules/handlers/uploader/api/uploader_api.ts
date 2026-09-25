import axios, { AxiosInstance, AxiosRequestConfig } from "axios";
import { createAxiosInstance } from "../../../../config/axios";

const email = process.env.UPLOADER_EMAIL!;
const password = process.env.UPLOADER_PASSWORD!;
const baseURL = process.env.UPLOADER_URL!;

const basic = Buffer
  .from(`${email}:${password}`)
  .toString("base64");

// Backoff exponencial reativo a 429, mesmo mecanismo de bling_api.service.ts
// (ver .claude/modules/uploader-queue.md).
const UPLOADER_429_MAX_RETRIES = Number(process.env.UPLOADER_429_MAX_RETRIES ?? 5);
const UPLOADER_429_BASE_DELAY_MS = Number(process.env.UPLOADER_429_BASE_DELAY_MS ?? 3000);
const UPLOADER_429_MAX_DELAY_MS = Number(process.env.UPLOADER_429_MAX_DELAY_MS ?? 60000);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function getRetryAfterMs(retryAfter?: string): number | null {
  if (!retryAfter) return null;

  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const dateMs = Date.parse(retryAfter);
  if (Number.isFinite(dateMs)) return Math.max(0, dateMs - Date.now());

  return null;
}

const uploaderApi: AxiosInstance = createAxiosInstance({
  baseURL,
  timeout: 15_000,
  headers: {
    Accept: '*/*',
    Authorization: `Basic ${basic}`
  },
  onResponseError: async (error: unknown) => {
    if (!axios.isAxiosError(error) || error.response?.status !== 429) {
      return Promise.reject(error);
    }

    const originalRequest = error.config as AxiosRequestConfig & {
      _uploader429Retries?: number;
    };
    const attempt = originalRequest._uploader429Retries ?? 0;

    if (attempt >= UPLOADER_429_MAX_RETRIES) {
      return Promise.reject(error);
    }

    originalRequest._uploader429Retries = attempt + 1;

    const retryAfterMs = getRetryAfterMs(error.response.headers?.["retry-after"]);
    const exponentialDelayMs = Math.min(
      UPLOADER_429_BASE_DELAY_MS * 2 ** attempt,
      UPLOADER_429_MAX_DELAY_MS,
    );
    const delayMs = Math.min(retryAfterMs ?? exponentialDelayMs, UPLOADER_429_MAX_DELAY_MS);

    console.warn(
      `[UploaderApi] 429 rate limit. Tentando novamente em ${Math.ceil(delayMs / 1000)}s (${attempt + 1}/${UPLOADER_429_MAX_RETRIES})`,
    );

    await sleep(delayMs);
    return uploaderApi(originalRequest);
  },
});

export default uploaderApi;