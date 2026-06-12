import { TCarConferenciaEstoqueService } from "./../../modules/handlers/tecinco/service/conferencias-estoque/conferencias-estoque.service";
/**
 * tecinco-migration.script.ts
 *
 * Script de migração inicial: busca todos os produtos e clientes da TeCinco
 * e enfileira na TCarUpsertQueue.
 *
 * Ordem:
 *   1. Produtos  (por filial)
 *   2. Clientes  (por filial)
 *
 * Uso:
 *   npx ts-node tecinco-migration.script.ts
 *   DRY_RUN=true npx ts-node tecinco-migration.script.ts
 */

import { v4 as uuidv4 } from "uuid";
import { Queue } from "bullmq";
import { setupAssociations } from "../../config/sequelize-associations";
import sequelize from "../../config/sequelize";
import { TCarProdutoService } from "../../modules/handlers/tecinco/service/produtos/produtos.service";
import TCarClienteService from "../../modules/handlers/tecinco/service/clientes/clientes.service";
import {
  TCarUpsertQueue,
  TCarUpsertJobPayload,
} from "../../modules/handlers/tecinco/queues/tecinco-api-fetch.queue";

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  await sequelize.authenticate();
  setupAssociations();
}

// ─── Configuração ─────────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN === "true";

/** Filiais a migrar — adicione quantas precisar */
const BRANCH_IDS: number[] = (process.env.TCAR_BRANCH_IDS ?? "1")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Boolean);

const COMPANY_ID = process.env.TCAR_COMPANY_ID ?? "default";

/** Tamanho de página (máximo que a TeCinco aceita — ajuste se necessário) */
const PAGE_SIZE = Number(process.env.TCAR_PAGE_SIZE ?? 100);

const MAX_ITEMS = Number(process.env.TCAR_MAX_ITEMS ?? 50);

/** Pausa entre páginas para não sobrecarregar a API (ms) */
const PAGE_DELAY_MS = Number(process.env.TCAR_PAGE_DELAY_MS ?? 300);

/** Intervalo de polling para aguardar fila esvaziar (ms) */
const QUEUE_POLL_MS = 5_000;

// ─── Fila (workless = só enfileira, não processa aqui) ────────────────────────

const upsertQueue = new TCarUpsertQueue({ workless: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function enqueue(payload: TCarUpsertJobPayload, jobId: string) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] ${jobId}`);
    return;
  }
  await upsertQueue.add(payload, jobId);
}

async function waitForQueueToDrain(label: string) {
  if (DRY_RUN) {
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

// ─── Paginação genérica ───────────────────────────────────────────────────────

interface TCarPage<T> {
  data: T[];
  pagination: {
    page: number;
    totalPages: number;
    total: number;
  };
}

async function* paginateTCar<T>(
  fetcher: (page: number, pageSize: number) => Promise<any>,
  max = MAX_ITEMS, // 👈
): AsyncGenerator<T[]> {
  let page = 1;
  let total = 0;

  while (true) {
    const response = await fetcher(page, PAGE_SIZE);

    if (typeof response === "string") {
      console.error("  ❌ Resposta ainda em string — onResponse não aplicado");
      break;
    }

    const items: T[] = Array.isArray(response?.data) ? response.data : [];
    if (!items.length) break;

    const slice = items.slice(0, max - total); // respeita o limite
    yield slice;
    total += slice.length;

    if (total >= max) break;
    if (page >= response.pagination?.totalPages) break;

    page++;
    await sleep(PAGE_DELAY_MS);
  }
}

// ─── 1. Produtos ──────────────────────────────────────────────────────────────

async function migrateProdutos() {
  console.log("─".repeat(55));
  console.log("📦  ETAPA 1 — Produtos");
  console.log("─".repeat(55));

  const service = new TCarProdutoService();

  for (const branchId of BRANCH_IDS) {
    console.log(`\n  🏢 Filial ${branchId}`);
    let count = 0;

    for await (const page of paginateTCar((p, ps) =>
      service.listarProdutos(branchId, { page: p, page_size: ps }),
    )) {
      for (const produto of page) {
        const p = produto as any;
        const systemId = String(p.epctb_codigo);

        await enqueue(
          {
            eventId: `migration-product-${systemId}-${uuidv4()}`,
            resource: "product",
            action: "sync",
            companyId: COMPANY_ID,
            branchId,
            data: p,
          },
          `migration-product-${branchId}-${systemId}`,
        );

        count++;
      }

      console.log(`  → ${count} produto(s) enfileirado(s)...`);
    }

    console.log(`  ✅ Filial ${branchId}: ${count} produtos`);
  }

  await waitForQueueToDrain("Produtos");
}

// ─── 2. Clientes ──────────────────────────────────────────────────────────────

async function migrateClientes() {
  console.log("─".repeat(55));
  console.log("👥  ETAPA 2 — Clientes");
  console.log("─".repeat(55));

  const service = new TCarClienteService();

  for (const branchId of BRANCH_IDS) {
    console.log(`\n  🏢 Filial ${branchId}`);
    let count = 0;

    for await (const page of paginateTCar((p, ps) =>
      service.listarClientes(branchId, { page: p, page_size: ps }),
    )) {
      for (const cliente of page) {
        const c = cliente as any;
        const systemId = String(c.cln_codigo);

        await enqueue(
          {
            eventId: `migration-customer-${systemId}-${uuidv4()}`,
            resource: "customer",
            action: "sync",
            companyId: COMPANY_ID,
            branchId,
            data: c,
          },
          `migration-customer-${branchId}-${systemId}`,
        );

        count++;
      }

      console.log(`  → ${count} cliente(s) enfileirado(s)...`);
    }

    console.log(`  ✅ Filial ${branchId}: ${count} clientes`);
  }

  await waitForQueueToDrain("Clientes");
}

// ─── 3. Notas Fiscais (XML → Invoice) ────────────────────────────────────────

async function migrateNotasFiscais() {
  console.log("─".repeat(55));
  console.log("🧾  ETAPA 3 — Notas Fiscais via XML");
  console.log("─".repeat(55));
  const conferenciaService = new TCarConferenciaEstoqueService();

  for (const branchId of BRANCH_IDS) {
    console.log(`\n  🏢 Filial ${branchId}`);

    // Busca todas as NF-e com chave (modelo 55, situação ativa)
    const resultado = await conferenciaService.listarNotasFiscais(branchId, {
      modelo_documento: 55,
      situacao: "A",
      entrada_saida: "E", // notas de entrada
      limit: 50,
    });

    console.log(`  → notas: `, resultado?.data ?? []);

    const notas: any[] = (resultado?.data ?? []).filter(
      (n: any) => n.entrada_saida === "E" && n.chave_nfe,
    );
    console.log(`  → ${notas.length} nota(s) encontrada(s)`);

    for (const nota of notas) {
      if (!nota.chave_nfe) continue; // ignora sem XML

      const { chave } = nota;
      const logPrefix = `  [NF nota=${chave.nota}]`;

      await enqueue(
        {
          eventId: `migration-invoice-xml-${branchId}-${chave.nota}-${uuidv4()}`,
          resource: "invoice_xml",
          action: "sync",
          companyId: COMPANY_ID,
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
        `migration-invoice-xml-${branchId}-${chave.nota}`,
      );

      console.log(`${logPrefix} enfileirada`);
    }
  }

  await waitForQueueToDrain("Notas Fiscais");
}

// ─── Runner ───────────────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(55));
  console.log("  🚀 TeCinco → Filas — Script de Migração Inicial");
  console.log(`  🏢 Filiais: ${BRANCH_IDS.join(", ")}`);
  console.log("═".repeat(55));

  if (DRY_RUN) {
    console.log("⚠️  MODO DRY_RUN ativo — nenhum job será enfileirado.\n");
  }

  await bootstrap();

  const start = Date.now();

  try {
    // await migrateProdutos();
    // await migrateClientes();
    await migrateNotasFiscais();
  } catch (err: any) {
    console.error("\n❌ Erro durante a migração:", err.message);
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("═".repeat(55));
  console.log(`  ✅ Migração concluída em ${elapsed}s`);
  console.log("═".repeat(55));

  process.exit(0);
}

main();
