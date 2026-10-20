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

// Uma página de listagem da Bling (usada pelo populate em massa, import manual e poll).
export async function fetchBlingListPage<T>(
  endpoint: string,
  query: BlingQuery = {},
  page = 1,
  pageSize = BLING_LIST_PAGE_SIZE,
): Promise<T[]> {
  const { data } = await blingGet<{ data: T[] }>(endpoint, blingApi, {
    params: toBlingParams({ ...query, pagina: page, limite: pageSize }),
    // Espaço como %20: a Bling não decodifica "+" e ignora filtro de data com hora ("YYYY-MM-DD HH:mm:ss").
    paramsSerializer: {
      serialize: (params) =>
        (params as URLSearchParams).toString().replace(/\+/g, "%20"),
    },
  });
  return data?.data ?? [];
}

// Itera página a página até a Bling devolver página vazia ou incompleta.
export async function* paginateBling<T>(
  endpoint: string,
  query: BlingQuery = {},
): AsyncGenerator<T[]> {
  for (let page = 1; ; page++) {
    const items = await fetchBlingListPage<T>(endpoint, query, page);
    if (!items.length) return;
    yield items;
    if (items.length < BLING_LIST_PAGE_SIZE) return;
  }
}

// situacao 2 da Bling = cancelada; o resto entra como aberta.
export function mapBlingInvoiceStatus(situacao?: number): "OPEN" | "CANCELLED" {
  return situacao === 2 ? "CANCELLED" : "OPEN";
}

// jobId único do fetch de NF-e no BLING_API_FETCH: stub do pedido e poll deduplicam entre si.
export function blingInvoiceFetchJobId(blingId: number | string): string {
  return `bling-invoice-fetch-${blingId}`;
}

// Payload de fetch de NF-e a partir do resumo da Bling (listagem ou detalhe); o worker busca o resto.
export function buildBlingInvoiceFetchPayload(invoice: {
  id: number;
  numero?: string;
  situacao?: number;
}): ApiFetchJobPayload {
  return buildBlingApiFetchPayload("invoice", invoice.id, {
    blingId: invoice.id,
    number: invoice.numero,
    id_system: String(invoice.id),
    status: mapBlingInvoiceStatus(invoice.situacao),
  });
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
