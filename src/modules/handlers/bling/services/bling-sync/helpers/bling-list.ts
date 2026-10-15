import { v4 as uuidv4 } from "uuid";
import { blingApi } from "../../../api/bling_api.service";
import { blingGet } from "../../bling/helpers/get-with-sleep";
import type { ApiFetchJobPayload } from "../../bling/queues/bling-api-fetch.queue";

// Máximo de registros por página que a listagem da Bling aceita.
export const BLING_LIST_PAGE_SIZE = 100;

// Filtros de listagem; array vira `chave[]` (ver toBlingParams).
export type BlingQuery = Record<string, string | number | number[]>;

// Resource da BLING_API_FETCH pra NF-e e NFC-e.
export type BlingInvoiceResource = "invoice" | "consumer_invoice";

// Bling espera filtro de lista como `chave[]=a&chave[]=b`.
export function toBlingParams(query: BlingQuery): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      value.forEach((item) => params.append(`${key}[]`, String(item)));
    } else {
      params.append(key, String(value));
    }
  }
  return params;
}

// Uma página de listagem da Bling (usada pelo populate em massa e pelo import manual).
export async function fetchBlingListPage<T>(
  endpoint: string,
  query: BlingQuery = {},
  page = 1,
): Promise<T[]> {
  const { data } = await blingGet<{ data: T[] }>(endpoint, blingApi, {
    params: toBlingParams({ ...query, pagina: page, limite: BLING_LIST_PAGE_SIZE }),
  });
  return data?.data ?? [];
}

// situacao 2 da Bling = cancelada; o resto entra como aberta.
export function mapBlingInvoiceStatus(situacao?: number): "OPEN" | "CANCELLED" {
  return situacao === 2 ? "CANCELLED" : "OPEN";
}

// Payload de BLING_API_FETCH no formato que o webhook gera (o worker busca o detalhe na Bling).
export function buildBlingApiFetchPayload(
  resource: ApiFetchJobPayload["resource"],
  blingId: number,
  partialData?: ApiFetchJobPayload["apiFetch"]["partialData"],
): ApiFetchJobPayload {
  return {
    eventId: `migration-${resource}-${blingId}-${uuidv4()}`,
    resource,
    action: "created",
    companyId: "",
    date: new Date().toISOString(),
    rawData: {},
    apiFetch: {
      resource,
      blingId,
      action: "created",
      companyId: "",
      ...(partialData ? { partialData } : {}),
    },
  };
}
