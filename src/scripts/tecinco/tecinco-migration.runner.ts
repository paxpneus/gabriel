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
  TCAR_INVOICE_NEW_PRIORITY,
  TCAR_INVOICE_UPDATE_JOB_NAME,
  TCAR_INVOICE_UPDATE_PRIORITY,
  TCAR_INVOICE_XML_UNAVAILABLE_FAILURE,
} from "../../modules/handlers/tecinco/queues/tecinco-invoice.queue";
import Invoice from "../../modules/warehouse/fiscal/invoices/invoice/invoice.model";
import invoiceService from "../../modules/warehouse/fiscal/invoices/invoice/invoice.service";
import { tecincoUnitBusinessForPopulate } from "../../shared/constants/tecinco-units";
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
// processInvoiceXml pode completar sem criar/cancelar a Invoice (nota sem item
// de pneu, XML 404/vazio) — sem retenção o job some e o sync reenfileira a mesma nota todo tick.
const INVOICE_JOB_RETENTION_SECONDS = 2 * 3600;
// Uma página só por listagem (API aceita limit até 500): roda todo tick, então sem paginação.
const INVOICE_LOOKBACK = 300;


// ─── Helpers internos ─────────────────────────────────────────────────────────

// Notas mais recentes (ordenação padrão EPENF_DTAINS DESC) de uma situação numa requisição só; sem entrada_saida traz os dois tipos.
async function listarNotasRecentes(
  service: TCarConferenciaEstoqueService,
  branchId: number,
  situacao: "A" | "N" | "C",
  entrada_saida?: "E" | "S",
): Promise<any[]> {
  const response = await service.listarNotasFiscais(branchId, {
    modelo_documento: 55,
    situacao,
    ...(entrada_saida ? { entrada_saida } : {}),
    limit: INVOICE_LOOKBACK,
    offset: 0,
  });
  const notas: any[] = Array.isArray(response?.data) ? response.data : [];
  return notas.filter(
    (nota) =>
      (!entrada_saida || nota.entrada_saida === entrada_saida) && nota.chave_nfe,
  );
}

// Payload do job invoice_xml (criação ou cancelamento) a partir de um item da listagem /notas-fiscais.
function buildInvoiceXmlPayload(
  nota: any,
  branchId: number,
  companyId: string,
): TCarUpsertJobPayload {
  const { chave } = nota;
  return {
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
  };
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

/** Lista as canceladas recentes: cria as que não existem no sistema e cancela as que ainda não estão CANCELLED em alguma unit business Tecinco. */
export async function migrateNotasCanceladas(
  opts: ResolvedMigrationOptions,
  { waitForDrain = true }: { waitForDrain?: boolean } = {},
): Promise<void> {
  const { branchIds, companyId, invoiceQueue, upsertQueue, dryRun } = opts;
  const targetInvoiceQueue = invoiceQueue ?? (upsertQueue as TCarInvoiceQueue);
  const service = new TCarConferenciaEstoqueService();

  console.log("─".repeat(55));
  console.log("🧾  Notas Fiscais canceladas");
  console.log("─".repeat(55));

  for (const branchId of branchIds) {
    // Nota que sumiu da listagem "A"/"N" ao ser cancelada só aparece aqui — uma requisição por filial, E e S juntos.
    const [notas, jobIdsPendentesOuRecentes, jobIdsSemXml] = await Promise.all([
      listarNotasRecentes(service, branchId, "C"),
      targetInvoiceQueue.getPendingJobIds(true),
      targetInvoiceQueue.getFailedJobIdsByReason(TCAR_INVOICE_XML_UNAVAILABLE_FAILURE),
    ]);
    const chaves = [...new Set(notas.map((nota) => String(nota.chave_nfe)))];
    const [existentes, chavesACancelar] = await Promise.all([
      Invoice.findAll({
        attributes: ["xml_key"],
        where: { xml_key: { [Op.in]: chaves } },
      }).then(
        (invoices) =>
          new Set(invoices.map((invoice) => invoice.xml_key).filter((key): key is string => !!key)),
      ),
      invoiceService
        .findXmlKeysNotCancelledInUnitBusinesses(chaves, tecincoUnitBusinessForPopulate)
        .then((keys) => new Set(keys)),
    ]);

    let criadas = 0;
    let canceladas = 0;
    for (const nota of notas) {
      const chaveNfe = String(nota.chave_nfe);
      if (!nota.chave?.nota) continue;
      const isNova = !existentes.has(chaveNfe);
      if (!isNova && !chavesACancelar.has(chaveNfe)) continue;

      // Cancelada que nunca entrou vai pelo invoice-new (mesmo jobId/dedup de migrateNovasNotasFiscais) e já nasce CANCELLED.
      const jobId = isNova
        ? `invoice-new-${branchId}-${nota.entrada_saida}-${nota.chave.nota}`
        : `invoice-update-${branchId}-${nota.entrada_saida}-${nota.chave.nota}`;
      if (jobIdsPendentesOuRecentes.has(jobId) || jobIdsSemXml.has(jobId)) continue;

      await enqueue(
        targetInvoiceQueue,
        buildInvoiceXmlPayload(nota, branchId, companyId),
        jobId,
        dryRun,
        {
          priority: isNova ? TCAR_INVOICE_NEW_PRIORITY : TCAR_INVOICE_UPDATE_PRIORITY,
          name: isNova ? TCAR_INVOICE_NEW_JOB_NAME : TCAR_INVOICE_UPDATE_JOB_NAME,
          removeOnComplete: { age: INVOICE_JOB_RETENTION_SECONDS },
        },
      );
      if (isNova) criadas++;
      else canceladas++;
    }
    console.log(
      `[TCAR_INVOICE] Filial ${branchId}: ${notas.length} cancelada(s) listada(s) — ${criadas} enfileirada(s) pra criar, ${canceladas} pra cancelar`,
    );
  }

  if (waitForDrain) {
    await waitForQueueToDrain(targetInvoiceQueue, "Notas Fiscais canceladas", dryRun);
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
  // Canceladas (criação e cancelamento) ficam com migrateNotasCanceladas.
  const situacoes: Array<"A" | "N"> = ["A", "N"];

  console.log("─".repeat(55));
  console.log("🧾  Novas notas fiscais via XML");
  console.log("─".repeat(55));

  for (const branchId of branchIds) {
    const combos = tipos.flatMap((entrada_saida) =>
      situacoes.map((situacao) => ({ entrada_saida, situacao })),
    );
    const resultados = await Promise.all(
      combos.map(({ entrada_saida, situacao }) =>
        listarNotasRecentes(service, branchId, situacao, entrada_saida),
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
    // INVOICE_JOB_RETENTION_SECONDS acima) na fila.
    // Também pula nota que esgotou as tentativas sem XML — fica failed no Redis.
    const [jobIdsPendentes, jobIdsPendentesOuRecentes, jobIdsSemXml] =
      await Promise.all([
        targetInvoiceQueue.getPendingJobIds(),
        targetInvoiceQueue.getPendingJobIds(true),
        targetInvoiceQueue.getFailedJobIdsByReason(
          TCAR_INVOICE_XML_UNAVAILABLE_FAILURE,
        ),
      ]);

    let enfileiradas = 0;
    for (let i = 0; i < combos.length; i++) {
      const { entrada_saida, situacao } = combos[i];
      const resumo = {
        enfileiradas: [] as string[],
        naFila: [] as string[],
        processadasRecentes: [] as string[],
        semXml: [] as string[],
      };

      for (const nota of resultados[i]) {
        if (existentes.has(String(nota.chave_nfe))) continue;
        const { chave } = nota;
        if (!chave?.nota) continue;
        const numero = String(chave.nota);
        const jobId = `invoice-new-${branchId}-${entrada_saida}-${numero}`;
        if (jobIdsSemXml.has(jobId)) {
          resumo.semXml.push(numero);
          continue;
        }
        if (jobIdsPendentes.has(jobId)) {
          resumo.naFila.push(numero);
          continue;
        }
        if (jobIdsPendentesOuRecentes.has(jobId)) {
          resumo.processadasRecentes.push(numero);
          continue;
        }
        await enqueue(
          targetInvoiceQueue,
          buildInvoiceXmlPayload(nota, branchId, companyId),
          jobId,
          dryRun ?? false,
          {
            priority: TCAR_INVOICE_NEW_PRIORITY,
            name: TCAR_INVOICE_NEW_JOB_NAME,
            removeOnComplete: { age: INVOICE_JOB_RETENTION_SECONDS },
          },
        );
        resumo.enfileiradas.push(numero);
        enfileiradas++;
      }

      const partes = [
        ["enfileiradas", resumo.enfileiradas],
        ["já na fila", resumo.naFila],
        ["processadas há <2h sem gerar invoice", resumo.processadasRecentes],
        ["failed sem XML", resumo.semXml],
      ] as const;
      const detalhe = partes
        .filter(([, numeros]) => numeros.length)
        .map(([label, numeros]) => `${label}: ${numeros.join(", ")}`)
        .join(" | ");
      if (detalhe) {
        console.log(`  → Filial ${branchId} [${entrada_saida}/${situacao}] notas sem invoice — ${detalhe}`);
      }
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

/** Enfileira o cancelamento das notas canceladas na Tecinco, sem esperar a fila esvaziar. */
export async function enqueueInvoiceCancellations(
  opts: RunMigrationOptions,
): Promise<void> {
  await migrateNotasCanceladas(resolveMigrationOptions(opts), {
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
  await Promise.all([migrateProdutos(resolved), migrateNotasCanceladas(resolved)]);
  await migrateClientes(resolved);
}
