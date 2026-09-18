/**
 * tecinco-duplicate-detection.ts
 *
 * Índice de códigos (codigoFabrica/EAN) duplicados no catálogo Tecinco —
 * usado pelo preflight do catalog sync (tecinco-migration.runner.ts) e por
 * ensureProductsFromInvoiceItems (tecinco-api-fetch.queue.ts), que precisa
 * do mesmo índice mas não pode pagar o custo de buscar o catálogo inteiro a
 * cada nota fiscal processada — daí o cache com TTL abaixo.
 */

import { TecincoCatalogItem, fetchTecincoCatalog } from "./dump-tecinco-catalog";
import { normalizeEan } from "../../modules/handlers/tecinco/queues/helpers/product.helpers";

export interface TecincoDuplicateValueSets {
  sku: Set<string>;
  ean: Set<string>;
}

function normalizeCatalogCode(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

// "sku" pra fins de detecção de duplicidade = código de fábrica, com
// epctb_coded só como fallback quando não tem código de fábrica — mesma
// regra usada pra decidir o sku persistido em UnmappedInvoiceProduct.
function effectiveSku(item: { sku?: string | null; coded?: string | null }): string | undefined {
  return normalizeCatalogCode(item.sku) ?? normalizeCatalogCode(item.coded);
}

// Só valores que aparecem em mais de um produto entram nos sets — um valor
// repetido 2x ou 200x é igualmente ambíguo pra auto-mapear, não tem "muito
// comum, deve ser só um preenchimento padrão" que torne isso seguro (foi
// exatamente esse tipo de valor reaproveitado que causou o incidente real
// que motivou esta camada).
export function buildTecincoDuplicateValueSets(
  items: TecincoCatalogItem[],
): TecincoDuplicateValueSets {
  const counts = {
    sku: new Map<string, number>(),
    ean: new Map<string, number>(),
  };

  for (const item of items) {
    const sku = effectiveSku(item);
    const ean = normalizeEan(item.ean ?? undefined);
    if (sku) counts.sku.set(sku, (counts.sku.get(sku) ?? 0) + 1);
    if (ean) counts.ean.set(ean, (counts.ean.get(ean) ?? 0) + 1);
  }

  const toDuplicateSet = (m: Map<string, number>) =>
    new Set([...m.entries()].filter(([, n]) => n > 1).map(([v]) => v));

  return {
    sku: toDuplicateSet(counts.sku),
    ean: toDuplicateSet(counts.ean),
  };
}

// Pra um produto específico, quais dos seus 2 códigos colidem com outro
// produto do catálogo — vazio significa que é seguro auto-mapear por
// código de fábrica/SupplierMapping.
export function findTecincoCollidingFields(
  item: { coded?: string | null; sku?: string | null; ean?: string | null },
  sets: TecincoDuplicateValueSets,
): string[] {
  const collided: string[] = [];
  const sku = effectiveSku(item);
  const ean = normalizeEan(item.ean ?? undefined);
  if (sku && sets.sku.has(sku)) collided.push(`sku=${sku}`);
  if (ean && sets.ean.has(ean)) collided.push(`ean=${ean}`);
  return collided;
}

// ─── Cache pra consumidores fora do preflight do catalog sync ──────────────
// O preflight (migrateProdutos) sempre busca o catálogo fresco porque roda
// pouca vezes (por sync). ensureProductsFromInvoiceItems roda por nota
// fiscal — buscar o catálogo Tecinco inteiro a cada nota seria uma chamada
// de API cara e desnecessária, então cacheia por branchIds com TTL.
const CACHE_TTL_MS = Number(process.env.TCAR_DUPLICATE_CACHE_TTL_MS ?? 30 * 60 * 1000);
const cache = new Map<string, { sets: TecincoDuplicateValueSets; expiresAt: number }>();
// TCAR_UPSERT processa notas com concurrency>1 (ver tecinco-api.md) — sem
// isso, N notas da mesma filial chegando com o cache frio ao mesmo tempo
// disparariam N buscas de catálogo completo em paralelo (confirmado em
// produção: "🔖 Grupo X" repetido intercalado com notas em processamento).
// Chamadas concorrentes pra mesma chave esperam a mesma busca em vez de
// cada uma refazer a sua.
const inFlight = new Map<string, Promise<TecincoDuplicateValueSets>>();

export async function getCachedTecincoDuplicateValueSets(
  branchIds: number[],
  logPrefix: string,
): Promise<TecincoDuplicateValueSets> {
  const key = [...branchIds].sort((a, b) => a - b).join(",");
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.sets;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const fetchPromise = (async () => {
    console.log(
      `${logPrefix} — recalculando índice de duplicidade Tecinco (branchIds=${key})`,
    );
    const catalog = await fetchTecincoCatalog({ branchIds });
    const sets = buildTecincoDuplicateValueSets(catalog);
    cache.set(key, { sets, expiresAt: Date.now() + CACHE_TTL_MS });
    return sets;
  })();

  inFlight.set(key, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    inFlight.delete(key);
  }
}

// migrateProdutos (preflight do catalog sync) já busca o catálogo inteiro
// pra montar seu próprio índice a cada run — em vez de deixar
// getCachedTecincoDuplicateValueSets buscar de novo do zero na próxima nota,
// ele empurra esse resultado pra cá, mantendo o cache sempre atualizado com
// o dado mais recente que o sync já pagou o custo de buscar.
export function setCachedTecincoDuplicateValueSets(
  branchIds: number[],
  sets: TecincoDuplicateValueSets,
): void {
  const key = [...branchIds].sort((a, b) => a - b).join(",");
  cache.set(key, { sets, expiresAt: Date.now() + CACHE_TTL_MS });
}
