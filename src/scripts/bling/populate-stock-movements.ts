/**
 * sync-stock-movements-from-bling-csv.script.ts
 *
 * Segunda etapa do processo de reconciliação de estoque com a Bling.
 * Lê o CSV gerado por `bling-stock-movements-scrape.script.ts`
 * (product_internal_id, es, entrada, saida, balanco, saldo_anterior,
 * custo_lancamento, origem_tipo, origem_numero, ...), agrupa por produto,
 * decide o que precisa virar MANUAL_ADJUSTMENT no sistema, e chama
 * `stockMovementService.reindexProduct` (que já protege qualquer linha
 * MANUAL_ADJUSTMENT com manual_average_cost_value preenchido).
 *
 * REGRAS DE NEGÓCIO (confirmadas com o time):
 *
 * 1. Linhas com origem "Nota fiscal" ou "Pedido de venda":
 *    NUNCA criamos MANUAL_ADJUSTMENT pra elas. Presumimos que já estão
 *    cobertas pelo fluxo normal (Invoice -> findStockMovementSourceData).
 *    Só verificamos, via invoice_number normalizado (zeros à esquerda
 *    removidos), se a NF realmente existe no sistema — se não existir,
 *    é só LOGADA como pendência, nunca criada automaticamente.
 *
 * 2. Qualquer outra linha (es=B sem origem, ou es=E/S sem origem de NF):
 *    vira MANUAL_ADJUSTMENT.
 *      - es === "B": delta = balanco - saldo_anterior
 *          - delta === 0  -> só LOG (sync de cadastro, sem efeito real)
 *          - delta !== 0  -> quantidade = abs(delta), direção pelo sinal
 *      - es === "E": quantidade = entrada, direção IN
 *      - es === "S": quantidade = saida,   direção OUT
 *
 * 3. manual_average_cost_value do MANUAL_ADJUSTMENT criado:
 *      - se já existe alguma PURCHASE_ENTRY real (nota de entrada) ANTES
 *        da data dessa linha -> null (herda o CMP corrente da cadeia)
 *      - senão, se custo_lancamento > 0 -> usa custo_lancamento como override
 *      - senão -> null (fica 0 até a próxima entrada real, mesmo
 *        comportamento que o sistema já tem hoje pra saldo negativo)
 *
 * 4. unit_business_id é FIXO: 361b5640-ec04-4b3f-8191-fe3ac5f134c4
 *
 * 5. Depois do reindexProduct, roda `syncProductStockMovements` com o
 *    saldo atual conhecido pela Bling (última linha cronológica do CSV)
 *    pra reconciliar qualquer resíduo (ex: vendas via "Pedido de venda"
 *    que ficaram sem nota) — mesma função que o sistema já usa hoje,
 *    sem duplicar lógica.
 *
 * SEGURANÇA:
 *   reindexProduct APAGA (hard delete) todo o histórico não-protegido do
 *   produto e recria do zero. Por isso:
 *     - roda em transação por produto (rollback automático em erro)
 *     - suporta DRY_RUN=true (não escreve nada, só loga o que faria)
 *     - suporta MAX_PRODUCTS pra testar com poucos produtos antes de rodar
 *       tudo
 *
 * Uso:
 *   CSV_PATH=./bling-stock-movements.csv DRY_RUN=true \
 *     npx ts-node scripts/sync-stock-movements-from-bling-csv.script.ts
 *
 *   Depois de validar o dry run:
 *   CSV_PATH=./bling-stock-movements.csv DRY_RUN=false \
 *     npx ts-node scripts/sync-stock-movements-from-bling-csv.script.ts
 *
 * Variáveis de ambiente:
 *   CSV_PATH        (obrigatória) caminho do CSV gerado pelo scraper
 *   UNIT_BUSINESS_ID (default: 361b5640-ec04-4b3f-8191-fe3ac5f134c4)
 *   DRY_RUN          (default: true)  — true = não escreve nada no banco
 *   MAX_PRODUCTS     (default: 0 = sem limite) útil pra testar
 *   ONLY_PRODUCT_ID   (opcional) processa só um product_internal_id específico
 */

import * as fs from "fs";
import * as path from "path";

import sequelize from "../../config/sequelize";
import { setupAssociations } from "../../config/sequelize-associations";
import stockMovementsService from "../../modules/inventory/stock/stock-movements/stock-movements.service";
import { ReindexProductPayload } from "../../modules/inventory/stock/stock-movements/stock-movements.types";

// ─── Configuração ───────────────────────────────────────────────────────────

const CSV_PATH = process.env.CSV_PATH
  ? path.resolve(process.env.CSV_PATH)
  : "";
const UNIT_BUSINESS_ID =
  process.env.UNIT_BUSINESS_ID ?? "361b5640-ec04-4b3f-8191-fe3ac5f134c4";
const DRY_RUN = process.env.DRY_RUN !== "false"; // default TRUE — precisa opt-out explícito
const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS ?? 0);
const ONLY_PRODUCT_ID = process.env.ONLY_PRODUCT_ID ?? "";

// ─── CSV parsing (RFC4180-ish, compatível com o csvEscape do scraper) ──────

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        fields.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
  }
  fields.push(cur);
  return fields;
}

function parseCsv(filePath: string): Record<string, string>[] {
  const content = fs.readFileSync(filePath, "utf8");
  // Suporta CRLF e LF, e ignora linhas totalmente vazias (ex: última linha)
  const lines = content.split(/\r?\n/).filter((l) => l.length > 0);
  if (!lines.length) return [];

  const header = parseCsvLine(lines[0]);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    header.forEach((col, idx) => {
      row[col] = values[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

// ─── Parsing de campos ───────────────────────────────────────────────────────

function parseNum(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * "16/07/2026 10:52:42" -> Date
 */
function parseBlingDate(value: string): Date {
  const [datePart, timePart] = value.trim().split(" ");
  const [day, month, year] = datePart.split("/").map(Number);
  const [hh, mm, ss] = (timePart ?? "00:00:00").split(":").map(Number);
  return new Date(year, month - 1, day, hh || 0, mm || 0, ss || 0);
}

function normalizeInvoiceNumber(value: string | number | null | undefined): string {
  const str = String(value ?? "").trim();
  const stripped = str.replace(/^0+/, "");
  return stripped.length ? stripped : "0";
}

// ─── Tipos internos ──────────────────────────────────────────────────────────

interface CsvRow {
  product_internal_id: string;
  product_name: string;
  bling_product_id: string;
  lancamento_id: string;
  es: "E" | "S" | "B" | string;
  data: Date;
  entrada: number;
  saida: number;
  balanco: number;
  saldo_anterior: number;
  custo_lancamento: number;
  origem_tipo: string;
  origem_numero: string;
}

function toCsvRow(raw: Record<string, string>): CsvRow {
  return {
    product_internal_id: raw.product_internal_id,
    product_name: raw.product_name,
    bling_product_id: raw.bling_product_id,
    lancamento_id: raw.lancamento_id,
    es: raw.es,
    data: parseBlingDate(raw.data),
    entrada: parseNum(raw.entrada),
    saida: parseNum(raw.saida),
    balanco: parseNum(raw.balanco),
    saldo_anterior: parseNum(raw.saldo_anterior),
    custo_lancamento: parseNum(raw.custo_lancamento),
    origem_tipo: (raw.origem_tipo ?? "").trim(),
    origem_numero: (raw.origem_numero ?? "").trim(),
  };
}

function isInvoiceBacked(row: CsvRow): boolean {
  return row.origem_tipo === "Nota fiscal" || row.origem_tipo === "Pedido de venda";
}

/**
 * Saldo resultante APÓS esse lançamento, na visão da Bling.
 * Pra "B" o próprio campo `balanco` já é o saldo resultante.
 * Pra "E"/"S" é saldo_anterior + entrada - saida.
 */
function resultingBalance(row: CsvRow): number {
  if (row.es === "B") return row.balanco;
  return row.saldo_anterior + row.entrada - row.saida;
}

// ─── Construção dos MANUAL_ADJUSTMENT a partir do CSV ───────────────────────

interface ManualAdjustmentDraft {
  movement_quantity: number;
  direction: "IN" | "OUT";
  movement_date: Date;
  manual_average_cost_value: number | null;
  source_lancamento_id: string;
}

interface ProductPlan {
  productInternalId: string;
  productName: string;
  manualAdjustments: ManualAdjustmentDraft[];
  missingInvoices: { origem_tipo: string; origem_numero: string; lancamento_id: string }[];
  zeroDeltaBalances: { lancamento_id: string; data: Date }[];
  actualQuantity: number;
}

function buildProductPlan(
  productInternalId: string,
  productName: string,
  rows: CsvRow[],
  purchaseEntryDates: Date[],
  existingInvoiceNumbers: Set<string>,
): ProductPlan {
  const sorted = [...rows].sort((a, b) => a.data.getTime() - b.data.getTime());

  const manualAdjustments: ManualAdjustmentDraft[] = [];
  const missingInvoices: ProductPlan["missingInvoices"] = [];
  const zeroDeltaBalances: ProductPlan["zeroDeltaBalances"] = [];

  const hasEarlierPurchaseEntry = (date: Date): boolean =>
    purchaseEntryDates.some((d) => d.getTime() < date.getTime());

  const resolveManualAverageCost = (row: CsvRow): number | null => {
    if (hasEarlierPurchaseEntry(row.data)) return null;
    if (row.custo_lancamento > 0) return row.custo_lancamento;
    return null;
  };

  for (const row of sorted) {
    if (isInvoiceBacked(row)) {
      // Só verificamos NF (pedido de venda já vem coberto pela NF vinculada,
      // conforme confirmado — não checamos pedido isoladamente).
      if (row.origem_tipo === "Nota fiscal") {
        const normalized = normalizeInvoiceNumber(row.origem_numero);
        if (!existingInvoiceNumbers.has(normalized)) {
          missingInvoices.push({
            origem_tipo: row.origem_tipo,
            origem_numero: row.origem_numero,
            lancamento_id: row.lancamento_id,
          });
        }
      }
      continue;
    }

    if (row.es === "B") {
      const delta = row.balanco - row.saldo_anterior;
      if (delta === 0) {
        zeroDeltaBalances.push({ lancamento_id: row.lancamento_id, data: row.data });
        continue;
      }
      manualAdjustments.push({
        movement_quantity: Math.abs(delta),
        direction: delta > 0 ? "IN" : "OUT",
        movement_date: row.data,
        manual_average_cost_value: resolveManualAverageCost(row),
        source_lancamento_id: row.lancamento_id,
      });
      continue;
    }

    if (row.es === "E" && row.entrada !== 0) {
      manualAdjustments.push({
        movement_quantity: row.entrada,
        direction: "IN",
        movement_date: row.data,
        manual_average_cost_value: resolveManualAverageCost(row),
        source_lancamento_id: row.lancamento_id,
      });
      continue;
    }

    if (row.es === "S" && row.saida !== 0) {
      manualAdjustments.push({
        movement_quantity: row.saida,
        direction: "OUT",
        movement_date: row.data,
        // Saída não deve "criar" custo médio novo — mantém o comportamento
        // padrão (herda o CMP corrente). Só entradas usam custo_lancamento.
        manual_average_cost_value: null,
        source_lancamento_id: row.lancamento_id,
      });
    }
  }

  const lastRow = sorted[sorted.length - 1];
  const actualQuantity = lastRow ? resultingBalance(lastRow) : 0;

  return {
    productInternalId,
    productName,
    manualAdjustments,
    missingInvoices,
    zeroDeltaBalances,
    actualQuantity,
  };
}

// ─── Processamento por produto ───────────────────────────────────────────────

interface ProcessResult {
  productInternalId: string;
  productName: string;
  manualAdjustmentsCreated: number;
  missingInvoicesLogged: number;
  zeroDeltaLogged: number;
  reconciliationDelta: number | null;
  error?: string;
}

async function processProduct(
  productInternalId: string,
  productName: string,
  rows: CsvRow[],
): Promise<ProcessResult> {
  // 1. Fonte "real" (nota fiscal) já existente/derivável do sistema —
  //    usada tanto pra saber quais notas já existem quanto pra decidir se
  //    já há PURCHASE_ENTRY antes de uma data.
  const sourceData = await stockMovementsService.findStockMovementSourceData(
    UNIT_BUSINESS_ID,
    productInternalId,
  );

  const purchaseEntryDates = sourceData
    .filter((m) => m.movement_type === "PURCHASE_ENTRY")
    .map((m) => new Date(m.movement_date));

  const existingInvoiceNumbers = new Set(
    sourceData
      .filter((m) => m.invoice_number != null)
      .map((m) => normalizeInvoiceNumber(m.invoice_number)),
  );

  const plan = buildProductPlan(
    productInternalId,
    productName,
    rows,
    purchaseEntryDates,
    existingInvoiceNumbers,
  );

  console.log(
    `\n[SyncStock] Produto ${productInternalId} (${productName}): ` +
      `${plan.manualAdjustments.length} ajuste(s) manual(is) a criar, ` +
      `${plan.missingInvoices.length} NF pendente(s), ` +
      `${plan.zeroDeltaBalances.length} balanço(s) com delta zero (ignorados), ` +
      `saldo Bling atual = ${plan.actualQuantity}`,
  );

  for (const missing of plan.missingInvoices) {
    console.log(
      `  ⚠️  NF não encontrada no sistema — lancamento_id=${missing.lancamento_id} ` +
        `origem_numero=${missing.origem_numero}. NÃO foi criada automaticamente.`,
    );
  }

  for (const zero of plan.zeroDeltaBalances) {
    console.log(
      `  ℹ️  Balanço sem efeito (delta=0) — lancamento_id=${zero.lancamento_id} ` +
        `data=${zero.data.toISOString()}. Ignorado.`,
    );
  }

  for (const adj of plan.manualAdjustments) {
    console.log(
      `  ${DRY_RUN ? "🔎 [DRY_RUN] criaria" : "✏️  criando"} MANUAL_ADJUSTMENT — ` +
        `lancamento_id=${adj.source_lancamento_id} data=${adj.movement_date.toISOString()} ` +
        `qty=${adj.movement_quantity} direction=${adj.direction} ` +
        `manual_average_cost_value=${adj.manual_average_cost_value ?? "null (herda)"}`,
    );
  }

  if (DRY_RUN) {
    return {
      productInternalId,
      productName,
      manualAdjustmentsCreated: plan.manualAdjustments.length,
      missingInvoicesLogged: plan.missingInvoices.length,
      zeroDeltaLogged: plan.zeroDeltaBalances.length,
      reconciliationDelta: null,
    };
  }

  const transaction = await sequelize.transaction();
  try {
    const manualMovements: ReindexProductPayload[] = plan.manualAdjustments.map(
      (adj) =>
        ({
          product_id: productInternalId,
          movement_type: "MANUAL_ADJUSTMENT",
          movement_quantity: adj.movement_quantity,
          movement_date: adj.movement_date,
          invoice_id: null,
          invoice_number: undefined,
          direction: adj.direction,
          manual_average_cost_value: adj.manual_average_cost_value,
        }) as unknown as ReindexProductPayload,
    );

    const mergedMovements: ReindexProductPayload[] = [
      ...sourceData,
      ...manualMovements,
    ];

    await stockMovementsService.reindexProduct(
      productInternalId,
      UNIT_BUSINESS_ID,
      mergedMovements,
      transaction,
    );

    // Reconciliação final — cobre resíduos (ex: "Pedido de venda" sem NF
    // ainda, contagens físicas não capturadas no CSV). Reaproveita a mesma
    // função que o sistema já usa hoje; como todas as NFs já foram
    // reindexadas acima, `pending` aqui deve vir vazio — só executa a
    // reconciliação de saldo por baixo dos panos.
    const before = await stockMovementsService.getCurrentBalance(
      productInternalId,
      UNIT_BUSINESS_ID,
    );
    const balanceBefore = before ? Number(before.balance_quantity) : 0;

    await stockMovementsService.syncProductStockMovements(
      productInternalId,
      UNIT_BUSINESS_ID,
      plan.actualQuantity,
      transaction,
    );

    const reconciliationDelta = plan.actualQuantity - balanceBefore;
    if (reconciliationDelta !== 0) {
      console.log(
        `  🧮 Reconciliação final aplicada — delta=${reconciliationDelta} ` +
          `(saldo sistema pós-reindex=${balanceBefore} -> saldo Bling=${plan.actualQuantity})`,
      );
    }

    await transaction.commit();

    return {
      productInternalId,
      productName,
      manualAdjustmentsCreated: plan.manualAdjustments.length,
      missingInvoicesLogged: plan.missingInvoices.length,
      zeroDeltaLogged: plan.zeroDeltaBalances.length,
      reconciliationDelta,
    };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

// ─── Bootstrap ────────────────────────────────────────────────────────────

async function bootstrap() {
  await sequelize.authenticate();
  setupAssociations();
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  if (!CSV_PATH) {
    throw new Error("CSV_PATH não definido. Passe o caminho do CSV gerado pelo scraper.");
  }
  if (!fs.existsSync(CSV_PATH)) {
    throw new Error(`CSV não encontrado em: ${CSV_PATH}`);
  }

  await bootstrap();

  console.log("═".repeat(60));
  console.log("🔄  Sync de stock_movements a partir do CSV da Bling");
  console.log(`  CSV: ${CSV_PATH}`);
  console.log(`  unit_business_id: ${UNIT_BUSINESS_ID}`);
  console.log(`  DRY_RUN: ${DRY_RUN}${DRY_RUN ? "  (nada será escrito no banco)" : "  ⚠️  ESCREVENDO NO BANCO"}`);
  console.log("═".repeat(60));

  const rawRows = parseCsv(CSV_PATH);
  const rows = rawRows.map(toCsvRow);

  const byProduct = new Map<string, { name: string; rows: CsvRow[] }>();
  for (const row of rows) {
    if (ONLY_PRODUCT_ID && row.product_internal_id !== ONLY_PRODUCT_ID) continue;
    const entry = byProduct.get(row.product_internal_id);
    if (entry) {
      entry.rows.push(row);
    } else {
      byProduct.set(row.product_internal_id, {
        name: row.product_name,
        rows: [row],
      });
    }
  }

  let productIds = [...byProduct.keys()];
  if (MAX_PRODUCTS) productIds = productIds.slice(0, MAX_PRODUCTS);

  console.log(`  Produtos únicos no CSV: ${byProduct.size}`);
  console.log(`  Produtos a processar nesta execução: ${productIds.length}`);
  console.log("═".repeat(60));

  const results: ProcessResult[] = [];
  const errors: { productInternalId: string; error: string }[] = [];

  for (let i = 0; i < productIds.length; i++) {
    const productId = productIds[i];
    const { name, rows: productRows } = byProduct.get(productId)!;

    try {
      const result = await processProduct(productId, name, productRows);
      results.push(result);
    } catch (err: any) {
      console.error(`  ❌ Erro no produto ${productId}: ${err.message}`);
      errors.push({ productInternalId: productId, error: err.message });
    }

    if ((i + 1) % 25 === 0 || i === productIds.length - 1) {
      console.log(
        `\n[SyncStock] Progresso: ${i + 1}/${productIds.length} produtos processados`,
      );
    }
  }

  const totalAdjustments = results.reduce((s, r) => s + r.manualAdjustmentsCreated, 0);
  const totalMissingInvoices = results.reduce((s, r) => s + r.missingInvoicesLogged, 0);
  const totalZeroDelta = results.reduce((s, r) => s + r.zeroDeltaLogged, 0);
  const totalReconciled = results.filter((r) => (r.reconciliationDelta ?? 0) !== 0).length;

  console.log("\n" + "═".repeat(60));
  console.log("  ✅ Finalizado");
  console.log(`  Modo: ${DRY_RUN ? "DRY_RUN (nada escrito)" : "EXECUÇÃO REAL"}`);
  console.log(`  Produtos processados: ${results.length}`);
  console.log(`  MANUAL_ADJUSTMENT ${DRY_RUN ? "que seriam criados" : "criados"}: ${totalAdjustments}`);
  console.log(`  NFs pendentes logadas (não criadas): ${totalMissingInvoices}`);
  console.log(`  Balanços com delta zero (ignorados): ${totalZeroDelta}`);
  if (!DRY_RUN) {
    console.log(`  Produtos com reconciliação final aplicada: ${totalReconciled}`);
  }
  console.log(`  Erros: ${errors.length}`);
  if (errors.length) {
    console.log("  Produtos com erro:");
    for (const e of errors) console.log(`    - ${e.productInternalId}: ${e.error}`);
  }
  console.log("═".repeat(60));

  process.exit(errors.length > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch(async (err) => {
    console.error("\n❌ Erro fatal:", err);
    process.exit(1);
  });
}