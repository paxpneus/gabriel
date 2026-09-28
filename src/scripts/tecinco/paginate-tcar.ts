// Extraído de tecinco-migration.runner.ts pra evitar import circular:
// dump-tecinco-catalog.ts precisa disso, e tecinco-migration.runner.ts
// (que importava fetchTecincoCatalog DE dump-tecinco-catalog.ts) arrasta
// tecinco-invoice.queue.ts -> tecinco-api-fetch.queue.ts, que por sua vez
// (via tecinco-duplicate-detection.ts) importa dump-tecinco-catalog.ts —
// fechando o ciclo e quebrando a classe TCarUpsertQueue com
// "Cannot access before initialization". Sem lógica nenhuma de fila/produto
// aqui de propósito, só paginação genérica — nada que puxe o resto do grafo.

const PAGE_SIZE = 50;
const PAGE_DELAY_MS = Number(process.env.TCAR_PAGE_DELAY_MS ?? 300);
const MAX_ITEMS = Number(process.env.TCAR_MAX_ITEMS ?? Infinity);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export async function* paginateTCar<T>(
  fetcher: (offset: number, limit: number) => Promise<any>,
  max = MAX_ITEMS,
): AsyncGenerator<T[]> {
  let offset = 0;
  let total = 0;

  while (true) {
    const response = await fetcher(offset, PAGE_SIZE);

    if (typeof response === "string") {
      console.error("  ❌ Resposta ainda em string — onResponse não aplicado");
      break;
    }

    const items: T[] = Array.isArray(response?.data) ? response.data : [];
    if (!items.length) break;

    const remaining = max - total;
    const slice = items.slice(0, remaining);
    yield slice;

    total += slice.length;

    if (total >= max || items.length < PAGE_SIZE) break;

    offset += PAGE_SIZE;
    await sleep(PAGE_DELAY_MS);
  }
}
