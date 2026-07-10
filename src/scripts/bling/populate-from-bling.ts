/**
 * bling-migration.script.ts
 *
 * Script de migração/sincronização: busca dados da Bling e enfileira
 * nas filas existentes (BlingDirectUpsertQueue e BlingApiFetchQueue).
 */

import { v4 as uuidv4 } from "uuid";
import { Queue } from "bullmq";
import { blingApi } from "../../modules/handlers/bling/api/bling_api.service";
import { ApiFetchJobPayload } from "../../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue";
import type { DirectUpsertJobPayload } from "../../modules/handlers/bling/services/bling/queues/bling-direct-upsert.queue";
import { BlingDirectUpsertQueue } from "../../modules/handlers/bling/services/bling/queues/bling-direct-upsert.queue";
import { BlingApiFetchQueue } from "../../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue";
import { BlingOrderQueue } from "../../modules/handlers/bling/services/bling-orders/bling-order.queue";
import { UnitBusiness } from "../../modules/warehouse";
import { setupAssociations } from "../../config/sequelize-associations";
import sequelize from "../../config/sequelize";
import {
  formatBlingInvoiceCutoffForLog,
  getBlingInvoiceReferenceDate,
  isKnownBlingInvoiceBeforeCutoff,
} from "../../modules/handlers/bling/services/bling/bling-invoice-cutoff";

// ─── Bootstrap do banco ───────────────────────────────────────────────────────

async function bootstrap() {
  await sequelize.authenticate();
  setupAssociations();
}

// ─── Configuração ─────────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN === "true";

/** Pausa entre páginas para respeitar o rate limit da Bling (ms) */
const PAGE_DELAY_MS = Number(process.env.BLING_SCRIPT_PAGE_DELAY_MS ?? 250);

/** Limite máximo de registros por entidade (0 = sem limite) */
const MAX_PER_ENTITY = Number(process.env.MAX_PER_ENTITY ?? 0);

/**
 * Intervalo de polling para verificar se as filas esvaziaram (ms).
 * Aumentar se o Redis estiver sobrecarregado.
 */
const QUEUE_POLL_MS = 5_000;

/**
 * Quantos dias para trás considerar no filtro incremental `dataAlteracaoInicial`.
 * Todas as entidades (exceto Estoques) só buscam registros criados/alterados
 * dentro desta janela.
 */
const INCREMENTAL_LOOKBACK_DAYS = Number(
  process.env.BLING_INCREMENTAL_LOOKBACK_DAYS ?? 2,
);

// ─── Data de corte ────────────────────────────────────────────────────────────

const DATA_INICIAL =
  process.env.BLING_MIGRATION_START_DATE ?? `${new Date().getFullYear()}-01-01`;

// ─── Filtro incremental por data de alteração ────────────────────────────────

/** Formata uma data no padrão exigido pela API da Bling: "YYYY-MM-DD HH:mm:ss" */
function formatBlingDateTime(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Retorna a string de `dataAlteracaoInicial` representando "N dias atrás, à meia-noite".
 * Calculada uma única vez no início da execução do script.
 */
function computeIncrementalFilterDate(): string {
  const date = new Date();
  date.setDate(date.getDate() - INCREMENTAL_LOOKBACK_DAYS);
  date.setHours(0, 0, 0, 0);
  return formatBlingDateTime(date);
}

/** Data mínima de alteração usada nos filtros `dataAlteracaoInicial` (produtos, contatos, vendedores) */
const DATA_ALTERACAO_INICIAL = computeIncrementalFilterDate();

/** Formata uma data no padrão "YYYY-MM-DD" (sem horário) */
function formatBlingDateOnly(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function daysAgo(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date;
}

/** Janela usada em /pedidos/vendas → dataInicial / dataFinal (formato "YYYY-MM-DD") */
const ORDERS_DATA_INICIAL = formatBlingDateOnly(daysAgo(INCREMENTAL_LOOKBACK_DAYS));
const ORDERS_DATA_FINAL = formatBlingDateOnly(new Date());

/** Janela usada em /nfe e /nfce → dataEmissaoInicial / dataEmissaoFinal (formato completo com horário) */
const INVOICE_DATA_EMISSAO_INICIAL = (() => {
  const d = daysAgo(INCREMENTAL_LOOKBACK_DAYS);
  d.setHours(0, 0, 0, 0);
  return formatBlingDateTime(d);
})();
const INVOICE_DATA_EMISSAO_FINAL = (() => {
  const d = new Date();
  d.setHours(23, 59, 59, 0);
  return formatBlingDateTime(d);
})();

// ─── Instâncias das filas (workless = só enfileira, não processa aqui) ────────

const directUpsertQueue = new BlingDirectUpsertQueue({ workless: true });
const apiFetchQueue = new BlingApiFetchQueue({ workless: true });
const orderQueue = new BlingOrderQueue(null as any, null as any, {
  workless: true,
});

// ─── Mapa loja Bling → UnitBusiness UUID ──────────────────────────────────────

type UnitBusinessMap = Record<string, string>;
let unitBusinessMap: UnitBusinessMap = {};

async function loadUnitBusinessMap() {
  const units = await UnitBusiness.findAll({ attributes: ["id", "id_system"] });
  unitBusinessMap = Object.fromEntries(units.map((u) => [u.id_system, u.id]));
  console.log(`  → ${units.length} UnitBusiness(es) carregado(s)`);
}

function resolveCompanyId(blingStoreId?: string | number): string {
  if (!blingStoreId) throw new Error("Bling store id não informado");
  const companyId = unitBusinessMap[String(blingStoreId)];
  if (!companyId)
    throw new Error(`UnitBusiness não encontrado para loja ${blingStoreId}`);
  return companyId;
}

function resolveOptionalCompanyId(
  blingStoreId?: string | number,
): string | null {
  if (!blingStoreId) return null;
  const companyId = unitBusinessMap[String(blingStoreId)];
  if (!companyId) {
    console.warn(
      `  ⚠️  UnitBusiness não encontrado para loja ${blingStoreId}. Vendedor será salvo sem unidade.`,
    );
    return null;
  }
  return companyId;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function makeEventId(resource: string, id: number | string) {
  return `migration-${resource}-${id}-${uuidv4()}`;
}

function basePayload(resource: string, blingId: number, companyId = "") {
  return {
    eventId: makeEventId(resource, blingId),
    resource: resource as any,
    action: "created" as const,
    companyId,
    date: new Date().toISOString(),
    rawData: {},
  };
}

async function enqueueDirectUpsert(
  payload: DirectUpsertJobPayload,
  jobId: string,
) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] DirectUpsert: ${jobId}`);
    return;
  }
  await directUpsertQueue.add(payload, jobId);
}

async function enqueueApiFetch(payload: ApiFetchJobPayload, jobId: string) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] ApiFetch: ${jobId}`);
    return;
  }
  await apiFetchQueue.add(payload, jobId);
}

async function blingGet<T>(
  endpoint: string,
  params?: Record<string, string | number>,
) {
  await sleep(PAGE_DELAY_MS);
  return blingApi.get<T>(endpoint, params ? { params } : undefined);
}

/**
 * Itera todas as páginas de um endpoint paginado da Bling.
 * Bling usa `pagina` (base 1) e `limite` (máx 100).
 */
async function* paginateBling<T>(
  endpoint: string,
  params: Record<string, string | number> = {},
  limitPerPage = 100,
): AsyncGenerator<T[]> {
  let page = 1;

  while (true) {
    const { data } = await blingGet<{ data: T[] }>(endpoint, {
      ...params,
      pagina: page,
      limite: limitPerPage,
    });

    const items: T[] = data?.data ?? [];
    if (!items.length) break;

    yield items;

    if (items.length < limitPerPage) break;
    page++;
  }
}

// ─── Aguardar filas esvaziarem ────────────────────────────────────────────────

/**
 * Bloqueia até que AMBAS as filas estejam com 0 jobs ativos + aguardando.
 * Garante que os workers terminaram de processar antes de passar para a
 * próxima etapa (evita erros de "produto não encontrado" etc.).
 */
async function waitForQueuesToDrain(label: string) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] Pulando espera de fila após: ${label}`);
    return;
  }

  console.log(`\n⏳ Aguardando filas esvaziarem após "${label}"...`);

  // Acessa as instâncias BullMQ internas das filas
  const queues: Queue[] = [
    (directUpsertQueue as any).queue,
    (apiFetchQueue as any).queue,
    (orderQueue as any).queue,
  ];

  while (true) {
    const counts = await Promise.all(
      queues.map((q) => q.getJobCounts("active", "waiting", "delayed")),
    );

    const totalPending = counts.reduce(
      (sum, c) => sum + (c.active ?? 0) + (c.waiting ?? 0) + (c.delayed ?? 0),
      0,
    );

    if (totalPending === 0) break;

    console.log(
      `  ↻ Jobs pendentes: ${totalPending} — checando novamente em ${QUEUE_POLL_MS / 1000}s...`,
    );
    await sleep(QUEUE_POLL_MS);
  }

  console.log(`  ✅ Filas vazias. Avançando...\n`);
}

// ─── 1. Produtos ──────────────────────────────────────────────────────────────

async function migrateProducts() {
  console.log("─".repeat(55));
  console.log("📦  ETAPA 1 — Produtos");
  console.log(`  🔄 Filtro: alterados desde ${DATA_ALTERACAO_INICIAL}`);
  console.log("─".repeat(55));

  // ── 1a. Coleta produtos alterados/criados na janela incremental ──────────
  const allProducts: { id: number; nome: string; codigo: string }[] = [];

  for await (const page of paginateBling<{
    id: number;
    nome: string;
    codigo: string;
  }>("/produtos", { dataAlteracaoInicial: DATA_ALTERACAO_INICIAL })) {
    for (const product of page) {
      allProducts.push(product);
      if (MAX_PER_ENTITY && allProducts.length >= MAX_PER_ENTITY) break;
    }
    console.log(`  → ${allProducts.length} produto(s) coletado(s)...`);
    if (MAX_PER_ENTITY && allProducts.length >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  📦 Total coletado: ${allProducts.length} produtos`);

  // ── 1c. ApiFetch: EAN real — só depois que todos os placeholders existem ──
  console.log("\n  ⏩ Fase 1c — ApiFetch (EAN real)");
  for (const product of allProducts) {
    const blingId = product.id;
    const jobBase = basePayload("product", blingId);

    await enqueueApiFetch(
      {
        ...jobBase,
        apiFetch: {
          resource: "product",
          blingId,
          action: "created",
          companyId: "",
        },
      },
      `migration-product-fetch-${blingId}`,
    );
  }

  await waitForQueuesToDrain("Produtos — ApiFetch");
}

// ─── 2. Fornecedores ──────────────────────────────────────────────────────────

async function migrateSuppliers() {
  console.log("─".repeat(55));
  console.log("🏭  ETAPA 2 — Fornecedores");
  console.log(`  🔄 Filtro: alterados desde ${DATA_ALTERACAO_INICIAL}`);
  console.log("─".repeat(55));

  let count = 0;
  const idsParaFiltrar = [
    17977550190, 17950521052, 17950116368, 17700189867, 16837235915,
    16821258764,
  ];

  for await (const page of paginateBling<{ id: number; nome: string }>(
    "/contatos",
    {
      tipoContato: 1, // 1 costuma ser Fornecedor no Bling V3
      idsContatos: idsParaFiltrar as any,
      dataAlteracaoInicial: DATA_ALTERACAO_INICIAL,
    },
  )) {
    for (const supplier of page) {
      const blingId = supplier.id;
      const jobBase = basePayload("supplier", blingId);

      // DirectUpsert: Salva supplier direto com dados do /contatos
      await enqueueDirectUpsert(
        {
          ...jobBase,
          directUpsert: {
            table: "suppliers",
            data: {
              id_system: String(blingId),
              name: supplier.nome,
              document: `PENDING-${blingId}`, // CNPJ será preenchido em ApiFetch
              fantasy_name: null,
              city: "",
              uf: "",
            },
          },
        },
        `migration-supplier-upsert-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }

    console.log(`  → ${count} fornecedor(es) enfileirado(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  🏭 Fornecedores enfileirados: ${count}`);

  // ⚠️  Aguarda — produto-fornecedor precisa de supplier no banco
  await waitForQueuesToDrain("Fornecedores");
}

// ─── 2.1. Vendedores ────────────────────────────────────────────────────────

async function migrateSellers() {
  console.log("─".repeat(55));
  console.log("👤  ETAPA 2.1 — Vendedores");
  console.log(`  🔄 Filtro: alterados desde ${DATA_ALTERACAO_INICIAL}`);
  console.log("─".repeat(55));

  let count = 0;

  for await (const page of paginateBling<{
    id: number;
    loja?: { id?: number };
    contato?: { id?: number; nome?: string; situacao?: string };
  }>("/vendedores", { dataAlteracaoInicial: DATA_ALTERACAO_INICIAL })) {
    for (const seller of page) {
      const blingId = seller.id;
      const jobBase = basePayload("seller", blingId);
      const unitBusinessId = resolveOptionalCompanyId(seller.loja?.id);

      await enqueueDirectUpsert(
        {
          ...jobBase,
          directUpsert: {
            table: "contacts",
            data: {
              id_system: String(blingId),
              name: seller.contato?.nome ?? "",
              type: "SELLER",
              unit_business_id: unitBusinessId,
            },
          },
        },
        `migration-seller-upsert-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }

    console.log(`  → ${count} vendedor(es) enfileirado(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  👤 Vendedores enfileirados: ${count}`);
  await waitForQueuesToDrain("Vendedores");
}

// ─── 3. Produto-Fornecedor ────────────────────────────────────────────────────

async function migrateProductSuppliers() {
  console.log("─".repeat(55));
  console.log("🔗  ETAPA 3 — Produto-Fornecedor");
  console.log(`  🔄 Filtro: alterados desde ${DATA_ALTERACAO_INICIAL}`);
  console.log("─".repeat(55));

  let count = 0;

  for await (const page of paginateBling<{
    id: number;
    codigo?: string;
    produto: { id: number };
    fornecedor: { id: number };
  }>("/produtos/fornecedores", {
    dataAlteracaoInicial: DATA_ALTERACAO_INICIAL,
  })) {
    for (const ps of page) {
      const blingId = ps.id;
      const jobBase = basePayload("product_supplier", blingId);

      // DirectUpsert: placeholder enquanto ApiFetch resolve CNPJ
      await enqueueDirectUpsert(
        {
          ...jobBase,
          directUpsert: {
            table: "product_supplier_maps",
            data: {
              productBlingId: ps.produto.id,
              supplierBlingId: ps.fornecedor.id,
              supplier_product_code: ps.codigo ?? "",
            },
          },
        },
        `migration-ps-upsert-${blingId}`,
      );

      // ApiFetch: resolve CNPJ real e atualiza o mapeamento
      await enqueueApiFetch(
        {
          ...jobBase,
          apiFetch: {
            resource: "product_supplier",
            blingId,
            action: "created",
            companyId: "",
          },
        },
        `migration-ps-fetch-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }

    console.log(`  → ${count} mapeamento(s) enfileirado(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  🔗 Produto-Fornecedores enfileirados: ${count}`);

  // ⚠️  Aguarda — estoques precisam do produto já salvo no banco
  await waitForQueuesToDrain("Produto-Fornecedor");
}

// ─── 4. Estoques ──────────────────────────────────────────────────────────────
// ⚠️  Única entidade que busca TODOS os produtos (sem filtro de data), pois o
//     saldo em estoque pode mudar sem que o produto em si seja "alterado".

async function migrateStocks() {
  console.log("─".repeat(55));
  console.log("📊  ETAPA 4 — Estoques (busca completa, sem filtro de data)");
  console.log("─".repeat(55));

  // Coleta TODOS os blingIds — sem filtro de dataAlteracao de propósito
  const allBlingIds: number[] = [];

  for await (const page of paginateBling<{ id: number }>("/produtos")) {
    for (const p of page) allBlingIds.push(p.id);
  }

  console.log(`  → ${allBlingIds.length} produto(s) para consulta de estoque`);

  if (!allBlingIds.length) {
    console.log("  ✅ Nenhum produto — etapa ignorada\n");
    return;
  }

  const BATCH_SIZE = 100;
  let count = 0;

  for (let i = 0; i < allBlingIds.length; i += BATCH_SIZE) {
    const batch = allBlingIds.slice(i, i + BATCH_SIZE);

    const params = new URLSearchParams();
    for (const id of batch) params.append("idsProdutos[]", String(id));
    params.append("filtroSaldoEstoque", "1");

    const { data } = await blingGet<{
      data: Array<{
        produto: { id: number };
        saldoFisicoTotal: number;
      }>;
    }>(`/estoques/saldos?${params.toString()}`);

    const saldos = data?.data ?? [];

    for (const stock of saldos) {
      const blingId = stock.produto.id;
      const jobBase = basePayload("stock", blingId);

      await enqueueDirectUpsert(
        {
          ...jobBase,
          directUpsert: {
            table: "stocks",
            data: {
              productBlingId: blingId,
              quantity: stock.saldoFisicoTotal ?? 0,
              unit_business_id: "RESOLVE_NO_WORKER",
            },
          },
        },
        `migration-stock-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }

    console.log(`  → ${count} estoque(s) enfileirado(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  📊 Estoques enfileirados: ${count}`);

  // ⚠️  Aguarda antes de notas fiscais (boa prática; NF não depende de estoque
  //    mas queremos logs limpos por etapa)
  await waitForQueuesToDrain("Estoques");
}

async function migrateOrders() {
  console.log("─".repeat(55));
  console.log("🛒  ETAPA — Pedidos");
  console.log(
    `  🔄 Filtro: dataInicial=${ORDERS_DATA_INICIAL} | dataFinal=${ORDERS_DATA_FINAL}`,
  );
  console.log("─".repeat(55));

  let totalCount = 0;

  for await (const page of paginateBling<{
    id: number;
    numero?: string;
    situacao?: string;
    data?: string;
    loja?: { id: number };
  }>("/pedidos/vendas", {
    dataInicial: ORDERS_DATA_INICIAL,
    dataFinal: ORDERS_DATA_FINAL,
  })) {
    for (const order of page) {
      const blingId = order.id;

      await (DRY_RUN
        ? Promise.resolve(
            console.log(`[DRY_RUN] OrderQueue: migration-order-${blingId}`),
          )
        : orderQueue.add(
            { event: "order.created", data: { id: blingId } },
            `migration-order-${blingId}`,
          ));

      totalCount++;
      if (MAX_PER_ENTITY && totalCount >= MAX_PER_ENTITY) break;
    }
    console.log(`  → ${totalCount} pedido(s) enfileirado(s)...`);
    if (MAX_PER_ENTITY && totalCount >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  🛒 Total de pedidos enfileirados: ${totalCount}`);
  await waitForQueuesToDrain("Pedidos");
}

// ─── 5 & 6. Notas Fiscais ─────────────────────────────────────────────────────

function mapSituacao(
  situacao?: number,
): "OPEN" | "PENDING" | "FINISHED" | "CANCELLED" {
  switch (situacao) {
    case 2:
      return "CANCELLED";
    default:
      return "OPEN";
  }
}

async function migrateInvoices(
  type: "NF-e" | "NFC-e",
  invoiceDirection: 0 | 1,
) {
  const resource = type === "NF-e" ? "invoice" : "consumer_invoice";
  const endpoint = type === "NF-e" ? "/nfe" : "/nfce";
  const etapa = type === "NF-e" ? 5 : 6;
  const icon = "🧾";

  console.log("─".repeat(55));
  console.log(`${icon}  ETAPA ${etapa} — Notas Fiscais ${type}`);
  console.log(
    `  🔄 Filtro: dataEmissaoInicial=${INVOICE_DATA_EMISSAO_INICIAL} | dataEmissaoFinal=${INVOICE_DATA_EMISSAO_FINAL}`,
  );
  console.log("─".repeat(55));

  let count = 0;
  let skipped = 0;

  for await (const page of paginateBling<{
    id: number;
    numero?: string;
    situacao?: number;
    tipo?: number;
    dataEmissao?: string;
    dataOperacao?: string;
    loja?: { id: number };
  }>(endpoint, {
    dataEmissaoInicial: INVOICE_DATA_EMISSAO_INICIAL,
    dataEmissaoFinal: INVOICE_DATA_EMISSAO_FINAL,
    tipo: invoiceDirection,
  })) {
    for (const invoice of page) {
      const blingId = invoice.id;
      const referenceDate = getBlingInvoiceReferenceDate(invoice);

      if (referenceDate && isKnownBlingInvoiceBeforeCutoff(referenceDate)) {
        skipped++;
        continue;
      }

      const jobBase = basePayload(resource, blingId);

      await enqueueApiFetch(
        {
          ...jobBase,
          apiFetch: {
            resource: resource as any,
            blingId,
            action: "created",
            companyId: "",
            partialData: {
              blingId,
              id_system: String(blingId),
              status: mapSituacao(invoice.situacao),
            },
          },
        },
        `migration-${resource}-fetch-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }

    console.log(`  → ${count} nota(s) enfileirada(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
  }

  console.log(
    `\n  ${icon} ${type} enfileiradas: ${count} | ignoradas: ${skipped}`,
  );

  await waitForQueuesToDrain(`Notas Fiscais ${type}`);
}

async function migrateCancelledInvoices(type: "NF-e" | "NFC-e") {
  const resource = type === "NF-e" ? "invoice" : "consumer_invoice";
  const endpoint = type === "NF-e" ? "/nfe" : "/nfce";
  const label = `${type} Canceladas`;

  console.log("─".repeat(55));
  console.log(`🚫  ETAPA — Notas Fiscais ${label}`);
  console.log(
    `  🔄 Filtro: dataEmissaoInicial=${INVOICE_DATA_EMISSAO_INICIAL} | dataEmissaoFinal=${INVOICE_DATA_EMISSAO_FINAL}`,
  );
  console.log("─".repeat(55));

  let count = 0;
  let skipped = 0;

  for await (const page of paginateBling<{
    id: number;
    situacao?: number;
    dataEmissao?: string;
    dataOperacao?: string;
  }>(endpoint, {
    dataEmissaoInicial: INVOICE_DATA_EMISSAO_INICIAL,
    dataEmissaoFinal: INVOICE_DATA_EMISSAO_FINAL,
    situacao: 2,
  })) {
    for (const invoice of page) {
      const blingId = invoice.id;
      const referenceDate = getBlingInvoiceReferenceDate(invoice);

      if (referenceDate && isKnownBlingInvoiceBeforeCutoff(referenceDate)) {
        skipped++;
        continue;
      }

      const jobBase = basePayload(resource, blingId);
      await enqueueApiFetch(
        {
          ...jobBase,
          apiFetch: {
            resource: resource as any,
            blingId,
            action: "created",
            companyId: "",
            partialData: {
              blingId,
              id_system: String(blingId),
              status: "CANCELLED",
            },
          },
        },
        `migration-${resource}-cancelled-fetch-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }
    console.log(`  → ${count} nota(s) cancelada(s) enfileirada(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  🚫 ${label} enfileiradas: ${count} | ignoradas: ${skipped}`);
  await waitForQueuesToDrain(`Notas Fiscais ${label}`);
}

// ─── Runner principal ─────────────────────────────────────────────────────────

async function main() {
  console.log("═".repeat(55));
  console.log("  🚀 Bling → Filas — Script de Migração/Sincronização");
  console.log(`  📅 Período: desde ${DATA_INICIAL}`);
  console.log(
    `  🔄 Filtro incremental (dataAlteracaoInicial): ${DATA_ALTERACAO_INICIAL}`,
  );
  console.log(
    `  🧾 NF somente a partir de ${formatBlingInvoiceCutoffForLog()}`,
  );
  console.log("═".repeat(55));

  if (DRY_RUN) {
    console.log("⚠️  MODO DRY_RUN ativo — nenhum job será enfileirado.\n");
  }

  await bootstrap();

  await loadUnitBusinessMap();

  const start = Date.now();

  try {
    // Ordem garantida + espera entre cada etapa
    await migrateProducts(); // 1 — sem dependências
    await migrateSuppliers(); // 2 — sem dependências
    await migrateSellers(); // 2.1 — sem dependências
    // await migrateProductSuppliers();  // 3 — depende de produto + fornecedor
    await migrateStocks(); // 4 — depende de produto (única etapa sem filtro de data)
    await migrateInvoices("NF-e", 0); // 6 — depende de UnitBusiness
    await migrateInvoices("NF-e", 1); // 5 — depende de UnitBusiness
    await migrateCancelledInvoices("NF-e");
    // await migrateOrders(); // pedidos depois de notas: mais lento e faz mais chamadas
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