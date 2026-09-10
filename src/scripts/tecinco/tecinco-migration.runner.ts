/**
 * tecinco-migration.runner.ts
 *
 * Módulo compartilhado com a lógica de migração/sync da TeCinco.
 * Usado tanto pelo script de migração full quanto pelo TCarSyncQueue (sync incremental).
 */

import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import { Queue } from "bullmq";
import { TCarProdutoService } from "../../modules/handlers/tecinco/service/produtos/produtos.service";
import TCarClienteService from "../../modules/handlers/tecinco/service/clientes/clientes.service";
import { TCarConferenciaEstoqueService } from "../../modules/handlers/tecinco/service/conferencias-estoque/conferencias-estoque.service";
import {
  TCarUpsertQueue,
  TCarUpsertJobPayload,
} from "../../modules/handlers/tecinco/queues/tecinco-api-fetch.queue";
import { getTCarIntegration } from "../../modules/handlers/tecinco/api/tecinco_api";
import { normalizeEan } from "../../modules/handlers/tecinco/queues/helpers/product.helpers";
import integrationMappingService from "../../modules/integrations/integration-mapping/integration-mapping.service";
import {
  fetchTecincoCatalog,
  CATALOG_OUTPUT_PATH,
  TecincoCatalogItem,
} from "./dump-tecinco-catalog";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface RunMigrationOptions {
  branchIds: number[];
  companyId: string;
  /**
   * Filtro incremental (formato "YYYY-MM-DD HH:mm:ss").
   * Quando omitido, busca todos os registros (migração full).
   */
  alteradoDesde?: string;
  upsertQueue: TCarUpsertQueue;
  /**
   * Se true, apenas loga os job IDs sem enfileirar nada.
   * Padrão: process.env.DRY_RUN === "true"
   */
  dryRun?: boolean;
  grupos?: string[];
}

// ─── Configuração ─────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;
const PAGE_DELAY_MS = Number(process.env.TCAR_PAGE_DELAY_MS ?? 300);
const MAX_ITEMS = Number(process.env.TCAR_MAX_ITEMS ?? Infinity);
const QUEUE_POLL_MS = 5_000;


// ─── Helpers internos ─────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function enqueue(
  upsertQueue: TCarUpsertQueue,
  payload: TCarUpsertJobPayload,
  jobId: string,
  dryRun: boolean,
) {
  if (dryRun) {
    console.log(`[DRY_RUN] ${jobId}`);
    return;
  }
  const job = await upsertQueue.add(payload, jobId);
  console.log(`enfileirado: ${job?.id ?? "DUPLICADO/IGNORADO"}`);
}

async function waitForQueueToDrain(
  upsertQueue: TCarUpsertQueue,
  label: string,
  dryRun: boolean,
) {
  if (dryRun) {
    console.log(`[DRY_RUN] Pulando espera após: ${label}`);
    return;
  }

  console.log(`\n⏳ Aguardando fila esvaziar após "${label}"...`);
  const queue: Queue = (upsertQueue as any).queue;

  while (true) {
    const counts = await queue.getJobCounts("active", "waiting", "delayed");
    const total =
      (counts.active ?? 0) + (counts.waiting ?? 0) + (counts.delayed ?? 0);
    if (total === 0) break;
    console.log(
      `  ↻ Jobs pendentes: ${total} — checando em ${QUEUE_POLL_MS / 1000}s...`,
    );
    await sleep(QUEUE_POLL_MS);
  }

  console.log(`  ✅ Fila vazia. Avançando...\n`);
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

// ─── Camada de segurança: dedup dentro do catálogo Tecinco ───────────────────
// A Tecinco reaproveita/duplica epctb_codigofabrica (com fallback pro campo
// epctb_coded quando não tem código de fábrica) e epctb_ean entre produtos
// físicos completamente diferentes (confirmado em produção — ver "Auto-map
// by EAN across integrations" no CLAUDE.md). Antes de enfileirar um produto
// sem mapeamento ainda pro processProduct, verificamos se algum desses 2
// códigos colide com outro produto do catálogo — se colidir, o
// auto-mapeamento por código de fábrica/SupplierMapping seria ambíguo,
// então a linha nunca chega a virar job: vira ERROR_CATALOG_DUPLICATE em
// unmapped_invoice_products pra revisão manual.

interface TecincoDuplicateValueSets {
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

// ─── Etapas ───────────────────────────────────────────────────────────────────

export async function migrateProdutos(
  opts: Required<RunMigrationOptions>,
): Promise<void> {
  const { branchIds, companyId, alteradoDesde, upsertQueue, dryRun, grupos } =
    opts;

  console.log("─".repeat(55));
  console.log("📦  Produtos");
  console.log("─".repeat(55));

  const service = new TCarProdutoService();

  // Se não vier grupos, mantém o comportamento antigo (sem filtro),
  // representado aqui por um array com "undefined".
  const gruposParaBuscar: Array<string | undefined> = grupos?.length
    ? grupos
    : [undefined];

  // Uma única busca cobrindo todas as filiais de uma vez (include=filiais),
  // em vez de uma requisição por filial — o estoque/preço de cada uma vem
  // dentro de produto.filiais. A sessão/autenticação usa a primeira filial
  // da lista; branch_ids define quais filiais retornam no array.
  const primaryBranchId = branchIds[0];
  const branchIdsParam = branchIds.join(",");
  let count = 0;
  let duplicateCount = 0;

  // ─── Pré-check: catálogo completo + índice de duplicidade ────────────────
  // Sempre o catálogo INTEIRO da Tecinco (todos os grupos de pneu, ignora
  // `alteradoDesde` e o filtro `grupos` deste run) — uma duplicidade pode
  // estar num produto fora do escopo desta sincronização específica. Limpa
  // qualquer JSON remanescente de uma execução anterior antes de começar, e
  // apaga o que este run gerou assim que o índice está pronto — o arquivo é
  // só um artefato intermediário, não deve sobrar no disco.
  if (fs.existsSync(CATALOG_OUTPUT_PATH)) {
    fs.unlinkSync(CATALOG_OUTPUT_PATH);
  }

  console.log("  🔍 Verificando duplicidade no catálogo Tecinco completo...");
  const fullCatalog = await fetchTecincoCatalog({ branchIds });
  fs.mkdirSync(path.dirname(CATALOG_OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(CATALOG_OUTPUT_PATH, JSON.stringify(fullCatalog, null, 2));

  const duplicateValueSets = buildTecincoDuplicateValueSets(fullCatalog);
  const integrations = await getTCarIntegration("Tecinco");
  const validExternalIds = await integrationMappingService.findValidExternalIdsSet(
    integrations.id,
  );

  fs.unlinkSync(CATALOG_OUTPUT_PATH);
  console.log(
    `  ✅ Índice de duplicidade pronto (${fullCatalog.length} produtos verificados, ${validExternalIds.size} já mapeados/existentes)\n`,
  );

  for (const grupo of gruposParaBuscar) {
    if (grupo !== undefined) {
      console.log(`  🔖 Grupo ${grupo}`);
    }

    for await (const page of paginateTCar((offset, limit) =>
      service.listarProdutos(primaryBranchId, {
        offset,
        limit,
        include: "filiais",
        branch_ids: branchIdsParam,
        ...(alteradoDesde ? { alterado_desde: alteradoDesde } : {}),
        ...(grupo !== undefined ? { grupo } : {}),
      }),
    )) {
      for (const produto of page) {
        const p = produto as any;
        const systemId = String(p.epctb_codigo);

        // Sempre enfileira — a decisão de usar (ou não) o fallback por
        // sku/ean quando colidindo agora é do processProduct, não daqui.
        // Só calculamos e propagamos a flag no payload do job (barato: só
        // lookup em Set, o índice já foi construído acima).
        const collidingFields = findTecincoCollidingFields(
          { coded: p.epctb_coded, sku: p.epctb_codigofabrica, ean: p.epctb_ean },
          duplicateValueSets,
        );
        const skuDuplicated = collidingFields.some((f) => f.startsWith("sku="));
        const eanDuplicated = collidingFields.some((f) => f.startsWith("ean="));
        if (collidingFields.length) duplicateCount++;

        await enqueue(
          upsertQueue,
          {
            eventId: `product-${systemId}-${Date.now()}`,
            resource: "product",
            action: "sync",
            companyId,
            branchId: primaryBranchId,
            data: p,
            skuDuplicated,
            eanDuplicated,
          },
          `product-${systemId}`,
          dryRun,
        );

        count++;
      }

      console.log(`  → ${count} produto(s) processado(s) (${duplicateCount} sinalizado(s) como duplicado no catálogo)...`);
    }
  }

  console.log(
    `  ✅ ${count} produtos (filiais: ${branchIdsParam}) — ${duplicateCount} sinalizado(s) como duplicado no catálogo`,
  );

  await waitForQueueToDrain(upsertQueue, "Produtos", dryRun);
}

export async function migrateClientes(
  opts: Required<RunMigrationOptions>,
): Promise<void> {
  const { branchIds, companyId, alteradoDesde, upsertQueue, dryRun } = opts;

  console.log("─".repeat(55));
  console.log("👥  Clientes");
  console.log("─".repeat(55));

  const service = new TCarClienteService();

  for (const branchId of branchIds) {
    console.log(`\n  🏢 Filial ${branchId}`);
    let count = 0;

    for await (const page of paginateTCar((offset, limit) =>
      service.listarClientes(branchId, {
        offset,
        limit,
        ...(alteradoDesde ? { alterado_desde: alteradoDesde } : {}),
      }),
    )) {
      for (const cliente of page) {
        const c = cliente as any;
        const systemId = String(c.cln_codigo ?? c.CLN_CODIGO);

        await enqueue(
          upsertQueue,
          {
            eventId: `customer-${branchId}-${systemId}-${uuidv4()}`,
            resource: "customer",
            action: "sync",
            companyId,
            branchId,
            data: c,
          },
          `customer-${branchId}-${systemId}`,
          dryRun,
        );

        count++;
      }

      console.log(`  → ${count} cliente(s) enfileirado(s)...`);
    }

    console.log(`  ✅ Filial ${branchId}: ${count} clientes`);
  }

  await waitForQueueToDrain(upsertQueue, "Clientes", dryRun);
}

export async function migrateNotasFiscais(
  opts: Required<RunMigrationOptions>,
): Promise<void> {
  const { branchIds, companyId, upsertQueue, dryRun } = opts;

  console.log("─".repeat(55));
  console.log("🧾  Notas Fiscais via XML");
  console.log("─".repeat(55));

  const service = new TCarConferenciaEstoqueService();

  const TIPOS: Array<"E" | "S"> = ["E", "S"];

  for (const branchId of branchIds) {
    console.log(`\n  🏢 Filial ${branchId}`);

    for (const tipo of TIPOS) {
      // Sempre busca as 50 notas mais recentes (ordenação padrão EPENF_DTAINS DESC),
      // sem filtro de data — dedup por jobId evita reprocessamento das já enfileiradas.
      const resultado = await service.listarNotasFiscais(branchId, {
        modelo_documento: 55,
        situacao: "A",
        entrada_saida: tipo,
        limit: 50,
        offset: 0,
      });

      const notas: any[] = (resultado?.data ?? []).filter(
        (n: any) => n.entrada_saida === tipo && n.chave_nfe,
      );

      console.log(`  → [${tipo}] ${notas.length} nota(s) encontrada(s)`);

      for (const nota of notas) {
        const { chave } = nota;

        await enqueue(
          upsertQueue,
          {
            eventId: `invoice-xml-${branchId}-${tipo}-${chave.nota}-${uuidv4()}`,
            resource: "invoice_xml",
            action: "sync",
            companyId,
            branchId,
            data: {
              numero: chave.nota,
              entrada_saida: nota.entrada_saida,
              cln_codigo: chave.cln_codigo,
              tpneg_codigo: chave.tpneg_codigo,
              ntz_codigo: chave.ntz_codigo,
              opr_codigo: chave.opr_codigo,
              serie: chave.serie,
              seq_cancelamento: chave.seq_cancelamento ?? "0",
            },
          },
          `invoice-xml-${branchId}-${tipo}-${chave.nota}`,
          dryRun,
        );

        console.log(`  [NF ${tipo} nota=${chave.nota}] enfileirada`);
      }
    }
  }

  await waitForQueueToDrain(upsertQueue, "Notas Fiscais", dryRun);
}

// ─── Entry point público ──────────────────────────────────────────────────────

export async function runMigration(opts: RunMigrationOptions): Promise<void> {
  const resolved: Required<RunMigrationOptions> = {
    dryRun: process.env.DRY_RUN === "true",
    alteradoDesde: "", // string vazia = sem filtro (full)
    grupos: [],

    ...opts,
  };

  if (resolved.dryRun) {
    console.log("⚠️  MODO DRY_RUN ativo — nenhum job será enfileirado.\n");
  }

  if (resolved.alteradoDesde) {
    console.log(
      `🔄  Sync incremental | alterado_desde=${resolved.alteradoDesde}\n`,
    );
  } else {
    console.log("🚀  Migração full — sem filtro de data\n");
  }

  // Produtos e Notas Fiscais rodam em paralelo (rate limit da Tecinco
  // comporta). Clientes só roda depois que os dois terminarem.
  await Promise.all([migrateProdutos(resolved), migrateNotasFiscais(resolved)]);
  // await Promise.all([migrateNotasFiscais(resolved)]);
  await migrateClientes(resolved);
}
