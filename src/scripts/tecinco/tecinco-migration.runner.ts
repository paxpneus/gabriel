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
import { Op } from "sequelize";
import { TCarProdutoService } from "../../modules/handlers/tecinco/service/produtos/produtos.service";
import TCarClienteService from "../../modules/handlers/tecinco/service/clientes/clientes.service";
import { TCarConferenciaEstoqueService } from "../../modules/handlers/tecinco/service/conferencias-estoque/conferencias-estoque.service";
import {
  TCarUpsertQueue,
  TCarUpsertJobPayload,
} from "../../modules/handlers/tecinco/queues/tecinco-api-fetch.queue";
import {
  TCarInvoiceQueue,
  TCAR_INVOICE_NEW_JOB_NAME,
  TCAR_INVOICE_UPDATE_JOB_NAME,
  TCAR_INVOICE_XML_UNAVAILABLE_FAILURE,
} from "../../modules/handlers/tecinco/queues/tecinco-invoice.queue";
import Invoice from "../../modules/warehouse/fiscal/invoices/invoice/invoice.model";
import { getTCarIntegration } from "../../modules/handlers/tecinco/api/tecinco_api";
import integrationMappingService from "../../modules/integrations/integration-mapping/integration-mapping.service";
import { fetchTecincoCatalog, CATALOG_OUTPUT_PATH } from "./dump-tecinco-catalog";
import { paginateTCar } from "./paginate-tcar";
import {
  buildTecincoDuplicateValueSets,
  findTecincoCollidingFields,
  setCachedTecincoDuplicateValueSets,
} from "./tecinco-duplicate-detection";

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
  invoiceQueue?: TCarInvoiceQueue;
  /**
   * Se true, apenas loga os job IDs sem enfileirar nada.
   * Padrão: process.env.DRY_RUN === "true"
   */
  dryRun?: boolean;
  grupos?: string[];
}

export type ResolvedMigrationOptions = Omit<Required<RunMigrationOptions>, "invoiceQueue"> & {
  invoiceQueue?: TCarInvoiceQueue;
};

// ─── Configuração ─────────────────────────────────────────────────────────────

const QUEUE_POLL_MS = 5_000;
// processInvoiceXml pode completar com sucesso sem criar Invoice (nota sem
// item de pneu, XML 404/vazio) — sem retenção, o job some do Redis na hora e
// migrateNovasNotasFiscais reenfileira a mesma nota todo tick pra sempre.
const INVOICE_NEW_JOB_RETENTION_SECONDS = 2 * 3600;
// 3 páginas por tipo × situação: com só 1 página, rajada de emissão empurrava nota pra fora antes de entrar.
const INVOICE_LOOKBACK = 150;


// ─── Helpers internos ─────────────────────────────────────────────────────────

// Notas mais recentes (ordenação padrão EPENF_DTAINS DESC) de um tipo × situação, até INVOICE_LOOKBACK.
async function listarNotasRecentes(
  service: TCarConferenciaEstoqueService,
  branchId: number,
  entrada_saida: "E" | "S",
  situacao: "A" | "N" | "C",
): Promise<any[]> {
  const notas: any[] = [];
  for await (const pagina of paginateTCar<any>(
    (offset, limit) =>
      service.listarNotasFiscais(branchId, {
        modelo_documento: 55,
        situacao,
        entrada_saida,
        limit,
        offset,
      }),
    INVOICE_LOOKBACK,
  )) {
    notas.push(...pagina);
  }
  return notas.filter(
    (nota) => nota.entrada_saida === entrada_saida && nota.chave_nfe,
  );
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function enqueue(
  upsertQueue: TCarUpsertQueue,
  payload: TCarUpsertJobPayload,
  jobId: string,
  dryRun: boolean,
  jobOptions?: {
    priority?: number;
    name?: string;
    removeOnComplete?: boolean | { age: number; count?: number };
  },
) {
  if (dryRun) {
    console.log(`[DRY_RUN] ${jobId}`);
    return;
  }
  const job = await upsertQueue.add(payload, jobId, jobOptions);
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


// ─── Etapas ───────────────────────────────────────────────────────────────────

export async function migrateProdutos(
  opts: ResolvedMigrationOptions,
  { waitForDrain = true }: { waitForDrain?: boolean } = {},
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
  // Alimenta o mesmo cache que ensureProductsFromInvoiceItems consulta na
  // resolução de nota fiscal — já buscamos o catálogo inteiro pra este run,
  // não faz sentido deixar a próxima nota buscar de novo do zero.
  setCachedTecincoDuplicateValueSets(branchIds, duplicateValueSets);
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

  if (waitForDrain) await waitForQueueToDrain(upsertQueue, "Produtos", dryRun);
}

export async function migrateClientes(
  opts: ResolvedMigrationOptions,
  { waitForDrain = true }: { waitForDrain?: boolean } = {},
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

  if (waitForDrain) await waitForQueueToDrain(upsertQueue, "Clientes", dryRun);
}

export async function migrateNotasFiscais(
  opts: ResolvedMigrationOptions,
  { waitForDrain = true }: { waitForDrain?: boolean } = {},
): Promise<void> {
  const { branchIds, companyId, invoiceQueue, upsertQueue, dryRun } = opts;
  const targetInvoiceQueue = invoiceQueue ?? (upsertQueue as TCarInvoiceQueue);

  console.log("─".repeat(55));
  console.log("🧾  Notas Fiscais via XML");
  console.log("─".repeat(55));

  const service = new TCarConferenciaEstoqueService();

  const TIPOS: Array<"E" | "S"> = ["E", "S"];
  // "A" pega as ativas recentes; "N" é uma nota normal (mesmo tratamento de
  // "A", confirmado com o usuário); "C" é necessário à parte porque uma nota
  // cancelada some da listagem "A"/"N" — sem isso o cancelamento na Tecinco
  // nunca é reenfileirado e a invoice já importada fica presa no status antigo.
  const SITUACOES: Array<"A" | "N" | "C"> = ["A", "N", "C"];

  for (const branchId of branchIds) {
    console.log(`\n  🏢 Filial ${branchId}`);

    // As 6 combinações (tipo × situação) são independentes — buscadas em
    // paralelo em vez de uma por vez.
    const combos = TIPOS.flatMap((tipo) =>
      SITUACOES.map((situacao) => ({ tipo, situacao })),
    );
    // Sem filtro de data — dedup por jobId evita reprocessamento das já enfileiradas.
    const resultados = await Promise.all(
      combos.map(({ tipo, situacao }) =>
        listarNotasRecentes(service, branchId, tipo, situacao),
      ),
    );

    for (let i = 0; i < combos.length; i++) {
      const { tipo, situacao } = combos[i];
      const notasEncontradas = resultados[i];
      const chaves = [...new Set(notasEncontradas.map((nota) => String(nota.chave_nfe)))];
      const chavesExistentes = new Set(
        (await Invoice.findAll({
          attributes: ["xml_key"],
          where: { xml_key: { [Op.in]: chaves } },
        }))
          .map((invoice) => invoice.xml_key)
          .filter((key): key is string => !!key),
      );
      const notas = notasEncontradas.filter((nota) =>
        chavesExistentes.has(String(nota.chave_nfe)),
      );

      console.log(
        `  → [${tipo}/${situacao}] ${notas.length}/${notasEncontradas.length} nota(s) existente(s) para atualizar`,
      );

      for (const nota of notas) {
        const { chave } = nota;

        await enqueue(
          targetInvoiceQueue,
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
          `invoice-update-${branchId}-${tipo}-${chave.nota}`,
          dryRun,
          { priority: 2, name: TCAR_INVOICE_UPDATE_JOB_NAME },
        );

        console.log(`  [NF ${tipo} nota=${chave.nota}] enfileirada`);
      }
    }
  }

  if (waitForDrain) {
    await waitForQueueToDrain(targetInvoiceQueue, "Notas Fiscais", dryRun);
  }
}

// ─── Entry point público ──────────────────────────────────────────────────────

/** Busca as notas recentes e enfileira somente as que ainda não têm XML no sistema. */
export async function migrateNovasNotasFiscais(
  opts: RunMigrationOptions,
): Promise<void> {
  const { branchIds, companyId, invoiceQueue, upsertQueue, dryRun } = opts;
  const targetInvoiceQueue = invoiceQueue ?? (upsertQueue as TCarInvoiceQueue);
  const service = new TCarConferenciaEstoqueService();
  const tipos: Array<"E" | "S"> = ["E", "S"];
  const situacoes: Array<"A" | "N" | "C"> = ["A", "N", "C"];

  console.log("─".repeat(55));
  console.log("🧾  Novas notas fiscais via XML");
  console.log("─".repeat(55));

  for (const branchId of branchIds) {
    const combos = tipos.flatMap((entrada_saida) =>
      situacoes.map((situacao) => ({ entrada_saida, situacao })),
    );
    const resultados = await Promise.all(
      combos.map(({ entrada_saida, situacao }) =>
        listarNotasRecentes(service, branchId, entrada_saida, situacao),
      ),
    );
    const notas = resultados.flat();
    const chaves = [...new Set(notas.map((nota: any) => String(nota.chave_nfe)))];
    const existentes = new Set(
      (await Invoice.findAll({
        attributes: ["xml_key"],
        where: { xml_key: { [Op.in]: chaves } },
      }))
        .map((invoice) => invoice.xml_key)
        .filter((key): key is string => !!key),
    );
    // Além do que já está no banco, pula quem já tem job pendente OU já
    // completou recentemente (mesmo sem criar Invoice — ver
    // INVOICE_NEW_JOB_RETENTION_SECONDS acima) na fila.
    // Também pula nota que esgotou as tentativas sem XML — fica failed no Redis.
    const [jobIdsPendentes, jobIdsSemXml] = await Promise.all([
      targetInvoiceQueue.getPendingJobIds(true),
      targetInvoiceQueue.getFailedJobIdsByReason(
        TCAR_INVOICE_XML_UNAVAILABLE_FAILURE,
      ),
    ]);

    let enfileiradas = 0;
    for (const nota of notas) {
      if (existentes.has(String(nota.chave_nfe))) continue;
      const { chave } = nota;
      if (!chave?.nota) continue;
      const jobId = `invoice-new-${branchId}-${nota.entrada_saida}-${chave.nota}`;
      if (jobIdsPendentes.has(jobId) || jobIdsSemXml.has(jobId)) continue;
      await enqueue(
        targetInvoiceQueue,
        {
          eventId: `invoice-xml-${branchId}-${nota.entrada_saida}-${chave.nota}-${uuidv4()}`,
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
        jobId,
        dryRun ?? false,
        {
          priority: 1,
          name: TCAR_INVOICE_NEW_JOB_NAME,
          removeOnComplete: { age: INVOICE_NEW_JOB_RETENTION_SECONDS },
        },
      );
      enfileiradas++;
    }
    console.log(`[TCAR_INVOICE] Filial ${branchId}: ${enfileiradas} nota(s) nova(s) enfileirada(s)`);
  }
}

function resolveMigrationOptions(
  opts: RunMigrationOptions,
): ResolvedMigrationOptions {
  const resolved: ResolvedMigrationOptions = {
    dryRun: process.env.DRY_RUN === "true",
    alteradoDesde: "", // string vazia = sem filtro (full)
    grupos: [],
    invoiceQueue: opts.invoiceQueue ?? (opts.upsertQueue as TCarInvoiceQueue),

    ...opts,
  };
  resolved.invoiceQueue ??= resolved.upsertQueue as TCarInvoiceQueue;
  return resolved;
}

/** Só produtos (fila TCAR_API_FETCH), sem esperar drenar; clientes vêm via nota fiscal. */
export async function runProductsMigration(
  opts: RunMigrationOptions,
): Promise<void> {
  await migrateProdutos(resolveMigrationOptions(opts), { waitForDrain: false });
}

/** Enfileira updates de notas existentes sem esperar a fila esvaziar. */
export async function enqueueInvoiceUpdates(
  opts: RunMigrationOptions,
): Promise<void> {
  await migrateNotasFiscais(resolveMigrationOptions(opts), {
    waitForDrain: false,
  });
}

export async function runMigration(opts: RunMigrationOptions): Promise<void> {
  const resolved = resolveMigrationOptions(opts);

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
