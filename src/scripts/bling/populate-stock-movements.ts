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
 * 1. Por produto, ANTES de qualquer coisa, apagamos (hard delete) todo
 *    MANUAL_ADJUSTMENT que NÃO tenha manual_average_cost_value preenchido.
 *    Os que têm manual_average_cost_value preenchido são IMUTÁVEIS — nunca
 *    são apagados nem editados por este script, em nenhuma hipótese.
 *    Rodamos um reindexProduct logo em seguida (só com a sourceData real)
 *    pra deixar a cadeia de saldo/custo médio limpa e consistente antes de
 *    montar o plano a partir do CSV. Isso evita ter que ficar comparando
 *    "o que já foi ajustado antes" — sempre reconstruímos os ajustes
 *    mutáveis do zero a partir do CSV a cada execução.
 *
 * 2. Linhas com origem "Pedido de venda":
 *    NUNCA criamos MANUAL_ADJUSTMENT pra elas — presumimos que ficam de
 *    resíduo e são cobertas pela reconciliação final (passo 6).
 *
 * 3. Linhas com origem "Nota fiscal":
 *    - Se a NF já existe no sistema (via invoice_number normalizado, zeros
 *      à esquerda removidos) -> nada a fazer, ela já está coberta pelo
 *      fluxo normal (Invoice -> findStockMovementSourceData).
 *    - Se a NF NÃO existe no sistema -> criamos um MANUAL_ADJUSTMENT com a
 *      quantidade/direção da linha, e preenchemos `invoice_number` com o
 *      número da nota (SEM vincular invoice_id — é só texto).
 *
 * 4. Notas "fantasma" — NFs que existem no NOSSO sistema (sourceData) mas
 *    cujo número não aparece em nenhuma linha "Nota fiscal" do CSV daquele
 *    produto:
 *      - Se a data do movimento da NF no sistema for POSTERIOR à última
 *        linha do CSV daquele produto específico -> é só nota emitida
 *        depois da extração do CSV, IGNORAMOS (não corrige nada).
 *      - Caso contrário -> a nota não deveria estar ali. Não mexemos na
 *        NF, mas lançamos um MANUAL_ADJUSTMENT de compensação na direção
 *        oposta e mesma quantidade (entrada -> ajuste de saída, saída ->
 *        ajuste de entrada), verificando antes se já não existe um ajuste
 *        imutável cobrindo isso.
 *
 * 5. Qualquer outra linha do CSV sem NF/Pedido de origem (es=B sem
 *    origem, ou es=E/S sem origem) vira MANUAL_ADJUSTMENT:
 *      - es === "B": delta = balanco - saldo_calculado_andando_pelo_csv
 *          - delta === 0  -> só LOG (sync de cadastro, sem efeito real)
 *          - delta !== 0  -> quantidade = abs(delta), direção pelo sinal
 *      - es === "E": quantidade = entrada, direção IN
 *      - es === "S": quantidade = saida,   direção OUT
 *
 * 6. manual_average_cost_value dos MANUAL_ADJUSTMENT criados (regras 3 e 5,
 *    entradas em geral):
 *      - se já existe alguma PURCHASE_ENTRY real (nota de entrada) ANTES
 *        da data dessa linha -> null (herda o CMP corrente da cadeia)
 *      - senão, se custo_lancamento > 0 -> usa custo_lancamento como override
 *      - senão -> null (fica 0 até a próxima entrada real, mesmo
 *        comportamento que o sistema já tem hoje pra saldo negativo)
 *    Ajustes de compensação de nota fantasma (regra 4) e de saída (regra 5,
 *    es="S") NUNCA recebem manual_average_cost_value (sempre null).
 *
 * 7. unit_business_id é FIXO: 361b5640-ec04-4b3f-8191-fe3ac5f134c4
 *
 * 8. Depois do reindexProduct final, roda `syncProductStockMovements`
 *    reconciliando contra o saldo cadastrado na tabela `stocks` (produto +
 *    unit_business padrão) — NÃO contra a última linha do CSV, porque o
 *    CSV pode estar um dia desatualizado (ex: notas emitidas de madrugada
 *    entre a extração e a execução do script).
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
import stockMovementService from "../../modules/inventory/stock/stock-movements/stock-movements.service";
import { ReindexProductPayload } from "../../modules/inventory/stock/stock-movements/stock-movements.types";
import Stock from "../../modules/inventory/stock/stock/stock.model";

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
 * ⚠️ IMPORTANTE: o endpoint interno da Bling (/Api/v3/estoques/list/lancamentos)
 * NÃO preenche `saldoAnterior` de forma confiável pra lançamentos "E"/"S" — na
 * prática ele quase sempre vem 0, mesmo quando o saldo real não era zero.
 * Confirmado em produção: isso já gerou um MANUAL_ADJUSTMENT de -195 num
 * produto, porque o "saldo atual" calculado a partir da última linha (que
 * tinha saldo_anterior=0) ficou negativo.
 *
 * Por isso NUNCA usamos `saldo_anterior` pra decidir saldo. Em vez disso,
 * reconstruímos o saldo andando cronologicamente pelas próprias linhas:
 *   - "B" (balanço): é um RESET ABSOLUTO — saldo passa a ser `balanco`,
 *     não importa o que veio antes.
 *   - "E"/"S": soma/subtrai `entrada`/`saida` do saldo acumulado.
 * Isso não depende de nenhum campo que a Bling possa deixar zerado.
 */
class RunningBalance {
  private value = 0;

  applyEntry(qty: number) {
    this.value += qty;
  }

  applyExit(qty: number) {
    this.value -= qty;
  }

  reset(newValue: number) {
    this.value = newValue;
  }

  get current(): number {
    return this.value;
  }
}

// ─── Construção dos MANUAL_ADJUSTMENT a partir do CSV ───────────────────────

interface ManualAdjustmentDraft {
  movement_quantity: number;
  direction: "IN" | "OUT";
  movement_date: Date;
  manual_average_cost_value: number | null;
  invoice_number?: string;
  source_lancamento_id: string;
}

interface GhostCompensationDraft {
  movement_quantity: number;
  direction: "IN" | "OUT";
  movement_date: Date;
  manual_average_cost_value: null;
  source_invoice_id: string | null;
  source_invoice_number: string;
}

interface ExistingManualAdjustment {
  movement_date: Date;
  movement_quantity: number;
  direction: "IN" | "OUT";
}

interface ProductPlan {
  productInternalId: string;
  productName: string;
  manualAdjustments: ManualAdjustmentDraft[];
  zeroDeltaBalances: { lancamento_id: string; data: Date }[];
  skippedAsAlreadyCovered: { lancamento_id: string; data: Date; qty: number }[];
}

interface GhostInvoicePlan {
  compensations: GhostCompensationDraft[];
  skippedFutureDated: { invoice_number: string; movement_date: Date }[];
  skippedAsAlreadyCovered: { invoice_number: string; movement_date: Date; qty: number }[];
}

/**
 * Compara um lançamento do CSV (ou um movimento de invoice) com os
 * MANUAL_ADJUSTMENT IMUTÁVEIS já existentes no sistema (com
 * manual_average_cost_value preenchido). Não temos o id do lançamento da
 * Bling salvo no banco, então a melhor aproximação possível é: mesma
 * quantidade, mesma direção, e data dentro de uma janela de 1 dia (cobre
 * pequenas diferenças de fuso/horário).
 */
function isAlreadyCoveredByExisting(
  date: Date,
  quantity: number,
  direction: "IN" | "OUT",
  existing: ExistingManualAdjustment[],
): boolean {
  const ONE_DAY_MS = 24 * 60 * 60 * 1000;
  return existing.some(
    (m) =>
      m.direction === direction &&
      Math.abs(m.movement_quantity - quantity) < 0.0001 &&
      Math.abs(m.movement_date.getTime() - date.getTime()) <= ONE_DAY_MS,
  );
}

/**
 * Colapsa sequências de linhas "B" consecutivas (sem nenhuma linha E/S no
 * meio, seja ela invoice-backed ou não) numa única linha: a ÚLTIMA
 * (cronologicamente mais recente) da sequência.
 *
 * Motivo: o saldo/custo que realmente "vale" antes do próximo evento real
 * (nota, pedido, entrada avulsa) é sempre o do balanço mais recente da
 * sequência — balanços mais antigos são só ruído de sincronismo de
 * cadastro da Bling (o custo registrado neles pode estar zerado ou
 * desatualizado). Se dois balanços estiverem separados por um evento real
 * no meio, cada um é mantido separadamente (a sequência quebra ali).
 *
 * Ex.: nota_entrada / balanço A / balanço B  (ordem cronológica) ->
 *      só o balanço B é mantido.
 * Ex.: balanço A / nota_entrada / balanço B  -> os 2 são mantidos.
 */
function collapseConsecutiveBalanceRuns(chronological: CsvRow[]): CsvRow[] {
  const result: CsvRow[] = [];
  let i = 0;
  while (i < chronological.length) {
    if (chronological[i].es !== "B") {
      result.push(chronological[i]);
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < chronological.length && chronological[j + 1].es === "B") {
      j++;
    }
    result.push(chronological[j]); // mantém só o último "B" da sequência
    i = j + 1;
  }
  return result;
}

function buildProductPlan(
  productInternalId: string,
  productName: string,
  rows: CsvRow[],
  purchaseEntryDates: Date[],
  existingInvoiceNumbers: Set<string>,
  existingManualAdjustments: ExistingManualAdjustment[],
): ProductPlan {
  const chronological = [...rows].sort((a, b) => a.data.getTime() - b.data.getTime());
  const sorted = collapseConsecutiveBalanceRuns(chronological);

  const manualAdjustments: ManualAdjustmentDraft[] = [];
  const zeroDeltaBalances: ProductPlan["zeroDeltaBalances"] = [];
  const skippedAsAlreadyCovered: ProductPlan["skippedAsAlreadyCovered"] = [];

  const hasEarlierPurchaseEntry = (date: Date): boolean =>
    purchaseEntryDates.some((d) => d.getTime() < date.getTime());

  const resolveManualAverageCost = (row: CsvRow): number | null => {
    if (hasEarlierPurchaseEntry(row.data)) return null;
    if (row.custo_lancamento > 0) return row.custo_lancamento;
    return null;
  };

  const balance = new RunningBalance();

  const tryCreateAdjustment = (
    row: CsvRow,
    quantity: number,
    direction: "IN" | "OUT",
    manualAverageCostValue: number | null,
    invoiceNumber?: string,
  ) => {
    if (isAlreadyCoveredByExisting(row.data, quantity, direction, existingManualAdjustments)) {
      skippedAsAlreadyCovered.push({ lancamento_id: row.lancamento_id, data: row.data, qty: quantity });
      return;
    }
    manualAdjustments.push({
      movement_quantity: quantity,
      direction,
      movement_date: row.data,
      manual_average_cost_value: manualAverageCostValue,
      invoice_number: invoiceNumber,
      source_lancamento_id: row.lancamento_id,
    });
  };

  for (const row of sorted) {
    if (isInvoiceBacked(row)) {
      let deltaForBalanceRow: number | null = null;

      if (row.es === "B") {
        deltaForBalanceRow = row.balanco - balance.current;
        balance.reset(row.balanco);
      } else {
        balance.applyEntry(row.entrada);
        balance.applyExit(row.saida);
      }

      // "Pedido de venda" nunca gera ajuste — segue igual ao comportamento
      // já existente (resíduo coberto pela reconciliação final).
      if (row.origem_tipo !== "Nota fiscal") continue;

      const normalized = normalizeInvoiceNumber(row.origem_numero);
      if (existingInvoiceNumbers.has(normalized)) continue; // NF já existe no sistema, nada a fazer

      // NF referenciada pela Bling mas ausente no nosso sistema -> cria
      // MANUAL_ADJUSTMENT com invoice_number preenchido (sem invoice_id).
      let quantity = 0;
      let direction: "IN" | "OUT" = "IN";

      if (row.es === "E") {
        quantity = row.entrada;
        direction = "IN";
      } else if (row.es === "S") {
        quantity = row.saida;
        direction = "OUT";
      } else if (row.es === "B" && deltaForBalanceRow !== null) {
        quantity = Math.abs(deltaForBalanceRow);
        direction = deltaForBalanceRow > 0 ? "IN" : "OUT";
      }

      if (quantity === 0) {
        zeroDeltaBalances.push({ lancamento_id: row.lancamento_id, data: row.data });
        continue;
      }

      tryCreateAdjustment(
        row,
        quantity,
        direction,
        direction === "IN" ? resolveManualAverageCost(row) : null,
        row.origem_numero,
      );
      continue;
    }

    if (row.es === "B") {
      const delta = row.balanco - balance.current;
      balance.reset(row.balanco);
      if (delta === 0) {
        zeroDeltaBalances.push({ lancamento_id: row.lancamento_id, data: row.data });
        continue;
      }
      tryCreateAdjustment(
        row,
        Math.abs(delta),
        delta > 0 ? "IN" : "OUT",
        resolveManualAverageCost(row),
      );
      continue;
    }

    if (row.es === "E" && row.entrada !== 0) {
      balance.applyEntry(row.entrada);
      tryCreateAdjustment(row, row.entrada, "IN", resolveManualAverageCost(row));
      continue;
    }

    if (row.es === "S" && row.saida !== 0) {
      balance.applyExit(row.saida);
      tryCreateAdjustment(row, row.saida, "OUT", null);
    }
  }

  return {
    productInternalId,
    productName,
    manualAdjustments,
    zeroDeltaBalances,
    skippedAsAlreadyCovered,
  };
}

/**
 * Detecta notas fiscais que existem no NOSSO sistema (sourceData) mas não
 * aparecem em nenhuma linha "Nota fiscal" do CSV daquele produto — ou seja,
 * a Bling não reconhece essa nota como pertencente a esse produto.
 *
 * Regra de corte por data: como o CSV tem uma data de corte (gerado antes
 * de hoje), uma NF do sistema com data POSTERIOR à última linha do CSV
 * daquele produto é simplesmente uma nota emitida depois da extração — não
 * é uma nota "errada", só não deu tempo de aparecer no CSV ainda.
 */
function buildGhostInvoicePlan(
  rows: CsvRow[],
  sourceData: { invoice_id: string; invoice_number?: string | null; movement_type: string; movement_quantity: number; movement_date: Date }[],
  existingManualAdjustments: ExistingManualAdjustment[],
): GhostInvoicePlan {
  const csvInvoiceNumbers = new Set(
    rows
      .filter((r) => r.origem_tipo === "Nota fiscal")
      .map((r) => normalizeInvoiceNumber(r.origem_numero)),
  );

  const lastCsvDate = rows.reduce(
    (max, r) => (r.data.getTime() > max.getTime() ? r.data : max),
    new Date(0),
  );

  const compensations: GhostCompensationDraft[] = [];
  const skippedFutureDated: GhostInvoicePlan["skippedFutureDated"] = [];
  const skippedAsAlreadyCovered: GhostInvoicePlan["skippedAsAlreadyCovered"] = [];

  for (const movement of sourceData) {
    if (!movement.invoice_number) continue;

    const normalized = normalizeInvoiceNumber(movement.invoice_number);
    if (csvInvoiceNumbers.has(normalized)) continue; // existe no CSV, não é fantasma

    const movementDate = new Date(movement.movement_date);

    if (movementDate.getTime() > lastCsvDate.getTime()) {
      skippedFutureDated.push({
        invoice_number: movement.invoice_number,
        movement_date: movementDate,
      });
      continue;
    }

    const isInbound =
      movement.movement_type === "PURCHASE_ENTRY" ||
      movement.movement_type === "CUSTOMER_RETURN";
    const compensationDirection: "IN" | "OUT" = isInbound ? "OUT" : "IN";
    const quantity = Number(movement.movement_quantity);

    if (
      isAlreadyCoveredByExisting(
        movementDate,
        quantity,
        compensationDirection,
        existingManualAdjustments,
      )
    ) {
      skippedAsAlreadyCovered.push({
        invoice_number: movement.invoice_number,
        movement_date: movementDate,
        qty: quantity,
      });
      continue;
    }

    compensations.push({
      movement_quantity: quantity,
      direction: compensationDirection,
      movement_date: movementDate,
      manual_average_cost_value: null,
      source_invoice_id: movement.invoice_id ?? null,
      source_invoice_number: movement.invoice_number,
    });
  }

  return { compensations, skippedFutureDated, skippedAsAlreadyCovered };
}

// ─── Processamento por produto ───────────────────────────────────────────────

interface ProcessResult {
  productInternalId: string;
  productName: string;
  manualAdjustmentsFromCsvCreated: number;
  ghostCompensationsCreated: number;
  ghostSkippedFutureDated: number;
  zeroDeltaLogged: number;
  reconciliationDelta: number | null;
  error?: string;
}

async function processProduct(
  productInternalId: string,
  productName: string,
  rows: CsvRow[],
): Promise<ProcessResult> {
  // 1. Fonte "real" (nota fiscal) já existente/derivável do sistema — usada
  //    tanto pra saber quais notas já existem quanto pra decidir se já há
  //    PURCHASE_ENTRY antes de uma data, e pra detectar notas fantasma.
  const sourceData = await stockMovementService.findStockMovementSourceData(
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

  // 2. MANUAL_ADJUSTMENT IMUTÁVEIS já existentes (com manual_average_cost_value
  //    preenchido) — são os únicos que sobrevivem à limpeza do passo 1 e os
  //    únicos usados em isAlreadyCoveredByExisting.
  const existingHistory = await stockMovementService.getProductHistory(
    productInternalId,
    UNIT_BUSINESS_ID,
    { page: 1, perPage: 5000 } as any,
  );
  const immutableManualAdjustments: ExistingManualAdjustment[] = existingHistory.data
    .filter(
      (m) =>
        m.movement_type === "MANUAL_ADJUSTMENT" &&
        m.is_active &&
        m.manual_average_cost_value != null,
    )
    .map((m) => ({
      movement_date: new Date(m.movement_date),
      movement_quantity: Number(m.movement_quantity),
      direction: (m.direction as "IN" | "OUT") ?? "IN",
    }));

  const plan = buildProductPlan(
    productInternalId,
    productName,
    rows,
    purchaseEntryDates,
    existingInvoiceNumbers,
    immutableManualAdjustments,
  );

  const ghostPlan = buildGhostInvoicePlan(
    rows,
    sourceData as any,
    immutableManualAdjustments,
  );

  console.log(
    `\n[SyncStock] Produto ${productInternalId} (${productName}): ` +
      `${plan.manualAdjustments.length} ajuste(s) manual(is) a criar a partir do CSV, ` +
      `${ghostPlan.compensations.length} compensação(ões) de nota fantasma a criar, ` +
      `${ghostPlan.skippedFutureDated.length} nota(s) fantasma ignorada(s) (emitida(s) após o CSV), ` +
      `${plan.zeroDeltaBalances.length} balanço(s) com delta zero (ignorados), ` +
      `${plan.skippedAsAlreadyCovered.length + ghostPlan.skippedAsAlreadyCovered.length} evento(s) já coberto(s) por ajuste imutável (pulados)`,
  );

  for (const zero of plan.zeroDeltaBalances) {
    console.log(
      `  ℹ️  Balanço sem efeito (delta=0) — lancamento_id=${zero.lancamento_id} ` +
        `data=${zero.data.toISOString()}. Ignorado.`,
    );
  }

  for (const skipped of plan.skippedAsAlreadyCovered) {
    console.log(
      `  ⏭️  lancamento_id=${skipped.lancamento_id} data=${skipped.data.toISOString()} ` +
        `qty=${skipped.qty} já parece coberto por um MANUAL_ADJUSTMENT imutável — não criado de novo.`,
    );
  }

  for (const adj of plan.manualAdjustments) {
    console.log(
      `  ${DRY_RUN ? "🔎 [DRY_RUN] criaria" : "✏️  criando"} MANUAL_ADJUSTMENT — ` +
        `lancamento_id=${adj.source_lancamento_id} data=${adj.movement_date.toISOString()} ` +
        `qty=${adj.movement_quantity} direction=${adj.direction} ` +
        `invoice_number=${adj.invoice_number ?? "-"} ` +
        `manual_average_cost_value=${adj.manual_average_cost_value ?? "null (herda)"}`,
    );
  }

  for (const future of ghostPlan.skippedFutureDated) {
    console.log(
      `  🕒 NF ${future.invoice_number} não está no CSV mas tem data ` +
        `${future.movement_date.toISOString()}, posterior ao corte do CSV — ignorada (provável nota emitida depois da extração).`,
    );
  }

  for (const skipped of ghostPlan.skippedAsAlreadyCovered) {
    console.log(
      `  ⏭️  Compensação da NF fantasma ${skipped.invoice_number} (data=${skipped.movement_date.toISOString()}, ` +
        `qty=${skipped.qty}) já parece coberta por um MANUAL_ADJUSTMENT imutável — não criada de novo.`,
    );
  }

  for (const comp of ghostPlan.compensations) {
    console.log(
      `  ${DRY_RUN ? "🔎 [DRY_RUN] criaria" : "✏️  criando"} MANUAL_ADJUSTMENT de compensação — ` +
        `NF fantasma ${comp.source_invoice_number} (invoice_id=${comp.source_invoice_id}) ` +
        `data=${comp.movement_date.toISOString()} qty=${comp.movement_quantity} direction=${comp.direction}`,
    );
  }

  if (DRY_RUN) {
    return {
      productInternalId,
      productName,
      manualAdjustmentsFromCsvCreated: plan.manualAdjustments.length,
      ghostCompensationsCreated: ghostPlan.compensations.length,
      ghostSkippedFutureDated: ghostPlan.skippedFutureDated.length,
      zeroDeltaLogged: plan.zeroDeltaBalances.length,
      reconciliationDelta: null,
    };
  }

  const transaction = await sequelize.transaction();
  try {
    // Passo 1: apaga (hard delete) todo MANUAL_ADJUSTMENT mutável (sem
    // manual_average_cost_value) desse produto. Os imutáveis nunca entram
    // nesse where (manual_average_cost_value: null exclui exatamente os
    // que têm valor preenchido).
    await stockMovementService.bulkDelete({
      where: {
        product_id: productInternalId,
        unit_business_id: UNIT_BUSINESS_ID,
        movement_type: "MANUAL_ADJUSTMENT",
        manual_average_cost_value: null,
      },
      transaction,
    });

    // Passo 2: reindex "base" — só com a sourceData real (notas do
    // sistema) + os imutáveis que sobreviveram, deixando a cadeia limpa.
    await stockMovementService.reindexProduct(
      productInternalId,
      UNIT_BUSINESS_ID,
      sourceData,
      transaction,
    );

    // Passo 3/4/5: monta os novos ajustes (CSV + compensações de nota
    // fantasma) e reindexa de novo, junto com a sourceData.
    const newManualMovements: ReindexProductPayload[] = [
      ...plan.manualAdjustments.map(
        (adj) =>
          ({
            product_id: productInternalId,
            movement_type: "MANUAL_ADJUSTMENT",
            movement_quantity: adj.movement_quantity,
            movement_date: adj.movement_date,
            invoice_id: null,
            invoice_number: adj.invoice_number,
            direction: adj.direction,
            manual_average_cost_value: adj.manual_average_cost_value,
          }) as unknown as ReindexProductPayload,
      ),
      ...ghostPlan.compensations.map(
        (comp) =>
          ({
            product_id: productInternalId,
            movement_type: "MANUAL_ADJUSTMENT",
            movement_quantity: comp.movement_quantity,
            movement_date: comp.movement_date,
            invoice_id: null,
            invoice_number: undefined,
            direction: comp.direction,
            manual_average_cost_value: null,
          }) as unknown as ReindexProductPayload,
      ),
    ];

    const mergedMovements: ReindexProductPayload[] = [
      ...sourceData,
      ...newManualMovements,
    ];

    await stockMovementService.reindexProduct(
      productInternalId,
      UNIT_BUSINESS_ID,
      mergedMovements,
      transaction,
    );

    // Passo 6: reconciliação final — contra o saldo CADASTRADO na tabela
    // `stocks` (produto + unit business padrão), não contra a última
    // linha do CSV (que pode estar um dia desatualizada).
    const stockRow = await Stock.findOne({
      where: {
        product_id: productInternalId,
        unit_business_id: UNIT_BUSINESS_ID,
      },
      transaction,
    });
    const targetQuantity = stockRow ? Number((stockRow as any).quantity) : 0;

    const before = await stockMovementService.getCurrentBalance(
      productInternalId,
      UNIT_BUSINESS_ID,
    );
    const balanceBefore = before ? Number(before.balance_quantity) : 0;

    await stockMovementService.syncProductStockMovements(
      productInternalId,
      UNIT_BUSINESS_ID,
      targetQuantity,
      transaction,
    );

    const reconciliationDelta = targetQuantity - balanceBefore;
    if (reconciliationDelta !== 0) {
      console.log(
        `  🧮 Reconciliação final aplicada — delta=${reconciliationDelta} ` +
          `(saldo sistema pós-reindex=${balanceBefore} -> saldo stocks=${targetQuantity})`,
      );
    }

    await transaction.commit();

    return {
      productInternalId,
      productName,
      manualAdjustmentsFromCsvCreated: plan.manualAdjustments.length,
      ghostCompensationsCreated: ghostPlan.compensations.length,
      ghostSkippedFutureDated: ghostPlan.skippedFutureDated.length,
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

  const totalCsvAdjustments = results.reduce((s, r) => s + r.manualAdjustmentsFromCsvCreated, 0);
  const totalGhostCompensations = results.reduce((s, r) => s + r.ghostCompensationsCreated, 0);
  const totalGhostFuture = results.reduce((s, r) => s + r.ghostSkippedFutureDated, 0);
  const totalZeroDelta = results.reduce((s, r) => s + r.zeroDeltaLogged, 0);
  const totalReconciled = results.filter((r) => (r.reconciliationDelta ?? 0) !== 0).length;

  console.log("\n" + "═".repeat(60));
  console.log("  ✅ Finalizado");
  console.log(`  Modo: ${DRY_RUN ? "DRY_RUN (nada escrito)" : "EXECUÇÃO REAL"}`);
  console.log(`  Produtos processados: ${results.length}`);
  console.log(`  MANUAL_ADJUSTMENT a partir do CSV ${DRY_RUN ? "que seriam criados" : "criados"}: ${totalCsvAdjustments}`);
  console.log(`  Compensações de nota fantasma ${DRY_RUN ? "que seriam criadas" : "criadas"}: ${totalGhostCompensations}`);
  console.log(`  Notas fantasma ignoradas (emitidas após o corte do CSV): ${totalGhostFuture}`);
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