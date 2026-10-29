/**
 * tecinco-duplicate-detection.ts
 *
 * Índice de códigos (codigoFabrica/EAN) duplicados no catálogo Tecinco —
 * usado pelo preflight do catalog sync (tecinco-migration.runner.ts) e pelo
 * job de produto do import manual (detectCatalogDuplicateFlags em tecinco-api-fetch.queue.ts), que precisa
 * do mesmo índice mas não pode pagar o custo de buscar o catálogo inteiro
 * a cada produto importado — daí o cache com TTL abaixo.
 */

import { TecincoCatalogItem, fetchTecincoCatalog } from "./dump-tecinco-catalog";
import { normalizeEan } from "../../modules/handlers/tecinco/queues/helpers/product.helpers";

// Valor duplicado → códigos do catálogo (id_sistema) que o usam; `.has(valor)` segue servindo de "é duplicado".
export interface TecincoDuplicateValueSets {
  sku: Map<string, string[]>;
  ean: Map<string, string[]>;
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
  const codes = {
    sku: new Map<string, string[]>(),
    ean: new Map<string, string[]>(),
  };
  const add = (m: Map<string, string[]>, value: string, code: string) => m.set(value, [...(m.get(value) ?? []), code]);

  for (const item of items) {
    const sku = effectiveSku(item);
    const ean = normalizeEan(item.ean ?? undefined);
    if (sku) add(codes.sku, sku, item.id_sistema);
    if (ean) add(codes.ean, ean, item.id_sistema);
  }

  const toDuplicateSet = (m: Map<string, string[]>) => new Map([...m.entries()].filter(([, list]) => list.length > 1));

  return {
    sku: toDuplicateSet(codes.sku),
    ean: toDuplicateSet(codes.ean),
  };
}

// Outros códigos do catálogo (fora `ownCode`) que compartilham o sku/ean do produto — pra quem precisa saber se a
// colisão é só entre códigos do mesmo produto local (aí não é ambígua).
export function findTecincoCollidingCodes(
  item: { coded?: string | null; sku?: string | null; ean?: string | null },
  sets: TecincoDuplicateValueSets,
  ownCode: string,
): { sku: string[]; ean: string[] } {
  const sku = effectiveSku(item);
  const ean = normalizeEan(item.ean ?? undefined);
  const others = (list?: string[]) => (list ?? []).filter((code) => code !== ownCode);
  return {
    sku: sku ? others(sets.sku.get(sku)) : [],
    ean: ean ? others(sets.ean.get(ean)) : [],
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
