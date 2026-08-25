import { Op, Transaction } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { Invoice, InvoiceItems, UnitBusiness } from "../../../warehouse";
import InvoiceUnitBusinessAttributes from "../../../warehouse/fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import StockMovement from "./stock-movements.model";
import stockMovementRepository, {
  StockMovementRepository,
} from "./stock-movements.repository";
import {
  ListSourceDataFromInvoices,
  ReindexProductPayload,
  StockMovementAttributes,
  StockMovementCreationAttributes,
  StockMovementType,
} from "./stock-movements.types";
import InvoiceFiscalItem from "../../../warehouse/fiscal/invoices/invoice-fiscal-item/invoice-fiscal-item.model";
import invoiceItemsService from "../../../warehouse/fiscal/invoices/invoice-items/invoice-items.service";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../shared/query/query.types";
import product_configService from "../../product-config/product_config.service";
import stockMovementSourceDataService from "../stock-movement-source-data/stock-movement-source-data.service";

// Estado de saldo/custo usado para encadear um movimento a partir do anterior.
type BalanceState = {
  balance_quantity: number;
  resulting_average_cost: number;
};

// Input genérico do cálculo da cadeia — desacoplado de ReindexProductPayload
// porque MANUAL_ADJUSTMENT não vem de nota fiscal (sem unit_cost_invoice) e
// precisa de `direction` pra saber se soma ou subtrai do saldo.
type ChainCalculationInput = {
  movement_type: StockMovementType;
  movement_quantity: number;
  unit_cost_invoice?: number;
  manual_average_cost_value?: number | null;
  direction?: "IN" | "OUT" | null;
};

// Payload de entrada da criação de um ajuste manual. `direction_type` só
// decide o sinal (entra/sai do estoque) — o movement_type gravado no banco
// é sempre "MANUAL_ADJUSTMENT", nunca o valor recebido aqui.
type CreateManualAdjustmentPayload = {
  movement_quantity: number;
  direction_type: "PURCHASE_ENTRY" | "SALE_OUT";
  manual_average_cost_value?: number | null;
  refers_to?: string | null;
  movement_date?: Date;
};

/**
 * O CSV da Bling pode trazer o número da NF sem os zeros à esquerda usados
 * pelo sistema. A normalização permite identificar o mesmo documento sem
 * precisar atribuir um invoice_id a um movimento consolidado pelo CSV.
 */
function normalizeInvoiceNumber(
  value: string | number | null | undefined,
): string | null {
  if (value == null) return null;

  const normalized = String(value).trim().replace(/^0+/, "");
  return normalized || "0";
}

/**
 * Chave de dedupe para uma entrada de CSV/SYNCHED dentro da janela do
 * baseline. Preferimos invoice_number normalizado (cobre tanto Nota fiscal
 * quanto Pedido de venda, que reaproveita o mesmo campo) — só cai pro
 * fingerprint por data/quantidade/tipo/direção quando não há
 * invoice_number (balanço avulso, ajuste sem origem).
 */
function buildCsvEntryFingerprint(entry: {
  invoice_number?: string | null;
  movement_type: string;
  movement_quantity: number;
  movement_date: Date;
  direction?: "IN" | "OUT" | null;
}): string {
  const normalized = normalizeInvoiceNumber(entry.invoice_number);
  if (normalized && normalized !== "0") {
    return `inv:${normalized}:${entry.movement_type}`;
  }

  return (
    `fp:${new Date(entry.movement_date).getTime()}` +
    `:${entry.movement_quantity}` +
    `:${entry.movement_type}` +
    `:${entry.direction ?? ""}`
  );
}

export class StockMovementService extends BaseService<
  StockMovement,
  StockMovementRepository
> {
  constructor() {
    super(stockMovementRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: ["created_at"],
        sortDir: "ASC",
      },
      filterableFields: ["type", "date"],
    };
  }

  /**
   * O CSV consolidado é o limite do histórico que os fluxos automáticos
   * podem tocar. `extraction_date` é global e prevalece; em instalações
   * antigas, sem registro da fonte, usa-se a última linha SYNCHED do próprio
   * produto como fallback.
   */
  private async getAutomaticSyncCutoff(
    productId: string,
    unitBusinessId: string,
    transaction?: Transaction,
    existingMovements?: StockMovement[],
  ): Promise<Date | null> {
    const latestSource = await stockMovementSourceDataService.findOne({
      order: [["extraction_date", "DESC"]],
      transaction,
    } as any);

    if (latestSource?.extraction_date) {
      return new Date(latestSource.extraction_date);
    }

    const history =
      existingMovements ??
      (await this.repository.findHistoryByProduct(productId, unitBusinessId, {
        transaction,
      }));
    const latestSynched = history
      .filter((movement) => movement.status === "SYNCHED")
      .sort(
        (a, b) =>
          new Date(b.movement_date).getTime() -
          new Date(a.movement_date).getTime(),
      )[0];

    return latestSynched ? new Date(latestSynched.movement_date) : null;
  }

  private async getLatestCsvExtractionDate(
    transaction?: Transaction,
  ): Promise<Date | null> {
    const latestSource = await stockMovementSourceDataService.findOne({
      order: [["extraction_date", "DESC"]],
      transaction,
    } as any);

    return latestSource?.extraction_date
      ? new Date(latestSource.extraction_date)
      : null;
  }

  // Atualiza custo médio do produto considerando o custo médio da ultima movimentação de estoque
  private async syncProductAverageCostConfig(
    productId: string,
    unitBusinessId: string,
    transaction?: Transaction,
  ): Promise<void> {
    const lastMovement = await this.repository.findLastMovement(
      productId,
      unitBusinessId,
      transaction,
    );

    if (!lastMovement) return;

    await product_configService.findOneAndUpdate(
      { product_id: productId, unit_business_id: unitBusinessId },
      {
        average_cost: Number(lastMovement.resulting_average_cost),
        average_cost_updated_at: new Date(),
      },
      { transaction },
    );
  }

  /**
   * Reconcilia a QUANTIDADE do saldo do sistema com o saldo real conhecido
   * (ex: saldoFisicoTotal da Bling). Cria um MANUAL_ADJUSTMENT com a
   * diferença — NUNCA escreve manual_average_cost_value, então o custo
   * médio é preservado automaticamente (calculateNextState já herda o
   * previousAverageCost pra MANUAL_ADJUSTMENT por padrão).
   *
   * Se o saldo já bate, não faz nada (retorna null).
   */
  private async reconcileProductBalance(
    productId: string,
    unitBusinessId: string,
    actualQuantity: number,
    transaction?: Transaction,
  ): Promise<StockMovement[] | null> {
    const lastMovement = await this.repository.findLastMovement(
      productId,
      unitBusinessId,
      transaction,
    );

    const currentBalance = lastMovement
      ? Number(lastMovement.balance_quantity)
      : 0;

    const delta = actualQuantity - currentBalance;

    if (delta === 0) return null;

    console.warn(
      `[STOCK_MOVEMENT] Reconciliação produto=${productId}: saldo sistema=${currentBalance}, saldo real=${actualQuantity}, delta=${delta}.`,
    );

    return this.createManualAdjustment(
      productId,
      unitBusinessId,
      {
        movement_quantity: Math.abs(delta),
        direction_type: delta > 0 ? "PURCHASE_ENTRY" : "SALE_OUT",
        manual_average_cost_value: null,
        movement_date: new Date(),
      },
      transaction,
    );
  }

  /**
   * Calcula o novo estado (saldo, CMP, valor total) a partir do estado anterior
   * e do tipo de movimento.
   *
   * MANUAL_ADJUSTMENT usa `direction` ("IN" soma, "OUT" subtrai) pra decidir o
   * sinal — não mexe no custo médio calculado por si só (só via override de
   * manual_average_cost_value, igual todo mundo).
   *
   * manual_average_cost_value, quando presente, substitui completamente o
   * resulting_average_cost calculado para ESTE movimento — e como esse valor
   * vira o `previous` do próximo movimento na cadeia, o override se propaga
   * naturalmente pra frente.
   */
  private calculateNextState(
    previous: BalanceState | null,
    input: ChainCalculationInput,
  ): BalanceState & { total_stock_value: number } {
    const previousQuantity = previous?.balance_quantity ?? 0;
    const previousAverageCost = previous?.resulting_average_cost ?? 0;
    const previousTotalValue = previousQuantity * previousAverageCost;

    let newQuantity: number;
    let newAverageCost: number;

    switch (input.movement_type) {
      case "PURCHASE_ENTRY": {
        newQuantity = previousQuantity + input.movement_quantity;

        const unitCost = input.unit_cost_invoice ?? 0;

        if (previousQuantity <= 0) {
          newAverageCost = unitCost;
        } else {
          const newEntryValue = input.movement_quantity * unitCost;
          const newTotalValue = previousTotalValue + newEntryValue;
          newAverageCost = newQuantity > 0 ? newTotalValue / newQuantity : 0;
        }
        break;
      }

      case "SALE_OUT": {
        newQuantity = previousQuantity - input.movement_quantity;
        newAverageCost = previousAverageCost;
        break;
      }

      case "CUSTOMER_RETURN": {
        newQuantity = previousQuantity + input.movement_quantity;
        newAverageCost = previousAverageCost;
        break;
      }

      case "MANUAL_ADJUSTMENT": {
        newQuantity =
          input.direction === "OUT"
            ? previousQuantity - input.movement_quantity
            : previousQuantity + input.movement_quantity;
        newAverageCost = previousAverageCost;
        break;
      }

      default:
        throw new Error(`Tipo de movimento inválido: ${input.movement_type}`);
    }

    const isOutwardManualAdjustment =
      input.movement_type === "MANUAL_ADJUSTMENT" && input.direction === "OUT";

    // Override manual: substitui completamente o custo médio calculado para
    // este movimento. Ex.: resulting calculado = 500, manual = 600 → o
    // movimento fica com 600, e os próximos movimentos usam 600 como base.
    if (
      ((input.manual_average_cost_value ?? 0) > 0 ||
        input.manual_average_cost_value != null) &&
      !isOutwardManualAdjustment
    ) {
      newAverageCost = input.manual_average_cost_value as number;
    }

    return {
      balance_quantity: newQuantity,
      resulting_average_cost: newAverageCost,
      total_stock_value: newQuantity * newAverageCost,
    };
  }

  async findLastEffectiveMovements(
    productIds: string[],
    unitBusinessId: string,
    asOfDate: Date,
    limit = 2,
  ): Promise<Map<string, StockMovement[]>> {
    return this.repository.findLastEffectiveMovements(
      productIds,
      unitBusinessId,
      asOfDate,
      limit,
    );
  }

  async getCurrentBalances(
    productIds: string[],
    unitBusinessId: string,
    asOfDate: Date,
  ): Promise<Map<string, StockMovement>> {
    return this.repository.findLastMovementsByProducts(
      productIds,
      unitBusinessId,
      asOfDate,
    );
  }

  /**
   * Consolida a janela temporal de um CSV. O CSV é a fonte de verdade apenas
   * entre o corte da extração anterior e a extração atual; movimentos do
   * fluxo normal fora dessa janela permanecem PENDING.
   */
  async syncCsvBaseline(
    productId: string,
    unitBusinessId: string,
    csvMovements: ReindexProductPayload[],
    cutoffDate: Date | null,
    extractionDate: Date,
    transaction?: Transaction,
  ): Promise<StockMovement[]> {
    if (cutoffDate && cutoffDate.getTime() > extractionDate.getTime()) {
      throw new Error("cutoffDate não pode ser posterior a extractionDate.");
    }

    await this.repository.deletePendingInCsvWindow(
      productId,
      unitBusinessId,
      cutoffDate,
      extractionDate,
      transaction,
    );

    const remaining = await this.repository.findHistoryByProduct(
      productId,
      unitBusinessId,
      { transaction },
    );

    const isProtected = (m: StockMovement) => m.refers_to != null;
    const isBeforeOrAtCutoff = (m: StockMovement) =>
      cutoffDate != null &&
      new Date(m.movement_date).getTime() <= cutoffDate.getTime();

    const existingSynchedFingerprints = new Set(
      remaining
        .filter((m) => {
          if (m.status !== "SYNCHED") return false;
          const date = new Date(m.movement_date).getTime();
          const afterCutoff = !cutoffDate || date > cutoffDate.getTime();
          return afterCutoff && date <= extractionDate.getTime();
        })
        .map((m) =>
          buildCsvEntryFingerprint({
            invoice_number: m.invoice_number,
            movement_type: m.movement_type,
            movement_quantity: Number(m.movement_quantity),
            movement_date: m.movement_date,
            direction: m.direction as "IN" | "OUT" | null,
          }),
        ),
    );

    // O estado anterior ao início da janela já foi consolidado e não deve ser
    // recalculado por esta execução.
    const baseline = remaining.filter(isBeforeOrAtCutoff);
    const lastBaseline = baseline[baseline.length - 1] ?? null;
    let previousState: BalanceState | null = lastBaseline
      ? {
          balance_quantity: Number(lastBaseline.balance_quantity),
          resulting_average_cost: Number(lastBaseline.resulting_average_cost),
        }
      : null;

    const pendingAfterExtraction = remaining.filter(
      (m) =>
        !isProtected(m) &&
        new Date(m.movement_date).getTime() > extractionDate.getTime(),
    );
    const protectedAfterCutoff = remaining.filter(
      (m) => !isBeforeOrAtCutoff(m) && isProtected(m),
    );
    const newCsvEntries = csvMovements.filter((m) => {
      const date = new Date(m.movement_date).getTime();
      const inWindow =
        (!cutoffDate || date > cutoffDate.getTime()) &&
        date <= extractionDate.getTime();
      if (!inWindow) return false;

      const fingerprint = buildCsvEntryFingerprint({
        invoice_number: m.invoice_number,
        movement_type: m.movement_type,
        movement_quantity: m.movement_quantity,
        movement_date: m.movement_date,
        direction: (m as any).direction ?? null,
      });

      if (existingSynchedFingerprints.has(fingerprint)) {
        console.log(
          `  ⏭️  [syncCsvBaseline] product=${productId} — lançamento já SYNCHED ` +
            `(invoice_number=${m.invoice_number ?? "-"}, tipo=${m.movement_type}, ` +
            `data=${new Date(m.movement_date).toISOString()}) — pulando, não recriando.`,
        );
        return false;
      }

      return true;
    });

    type TimelineEntry =
      | { kind: "csv"; date: Date; payload: ReindexProductPayload }
      | { kind: "protected"; date: Date; movement: StockMovement }
      | { kind: "pending"; date: Date; movement: StockMovement };

    const timeline: TimelineEntry[] = [
      ...newCsvEntries.map((payload) => ({
        kind: "csv" as const,
        date: new Date(payload.movement_date),
        payload,
      })),
      ...protectedAfterCutoff.map((movement) => ({
        kind: "protected" as const,
        date: new Date(movement.movement_date),
        movement,
      })),
      ...pendingAfterExtraction.map((movement) => ({
        kind: "pending" as const,
        date: new Date(movement.movement_date),
        movement,
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    const toCreate: StockMovementCreationAttributes[] = [];
    const toUpdate: {
      movement: StockMovement;
      nextState: ReturnType<StockMovementService["calculateNextState"]>;
    }[] = [];

    for (const entry of timeline) {
      if (entry.kind === "protected") {
        previousState = {
          balance_quantity: Number(entry.movement.balance_quantity),
          resulting_average_cost: Number(entry.movement.resulting_average_cost),
        };
        continue;
      }

      if (entry.kind === "csv") {
        const movement = entry.payload;
        const nextState = this.calculateNextState(previousState, {
          ...movement,
          manual_average_cost_value: movement.manual_average_cost_value ?? null,
        });

        toCreate.push({
          unit_business_id: unitBusinessId,
          product_id: productId,
          invoice_id: movement.invoice_id,
          invoice_number: movement.invoice_number,
          movement_type: movement.movement_type,
          movement_date: movement.movement_date,
          movement_quantity: movement.movement_quantity,
          unit_cost_invoice: movement.unit_cost_invoice,
          direction: (movement as any).direction ?? null,
          manual_average_cost_value: movement.manual_average_cost_value ?? null,
          status: "SYNCHED",
          is_active: true,
          ...nextState,
        } as StockMovementCreationAttributes);

        previousState = {
          balance_quantity: nextState.balance_quantity,
          resulting_average_cost: nextState.resulting_average_cost,
        };
        continue;
      }

      // PENDING pós-cutoff: preserva o "fato" (quantidade/direção/invoice),
      // só recalcula o resultado — igual upsertProductStockMovements faz.
      const movement = entry.movement;
      const direction = movement.direction as "IN" | "OUT" | null;
      const nextState = this.calculateNextState(previousState, {
        movement_type: movement.movement_type,
        movement_quantity: Number(movement.movement_quantity),
        unit_cost_invoice:
          movement.unit_cost_invoice != null
            ? Number(movement.unit_cost_invoice)
            : undefined,
        manual_average_cost_value:
          (movement.manual_average_cost_value ?? 0) > 0 ||
          movement.manual_average_cost_value != null
            ? Number(movement.manual_average_cost_value)
            : null,
        direction,
      });

      toUpdate.push({ movement, nextState });
      previousState = {
        balance_quantity: nextState.balance_quantity,
        resulting_average_cost: nextState.resulting_average_cost,
      };
    }

    const created = toCreate.length
      ? await this.repository.bulkCreate(toCreate as any, { transaction })
      : [];

    for (const { movement, nextState } of toUpdate) {
      const hasDrifted =
        Number(movement.balance_quantity) !== nextState.balance_quantity ||
        Number(movement.resulting_average_cost) !==
          nextState.resulting_average_cost ||
        Number(movement.total_stock_value) !== nextState.total_stock_value;

      if (hasDrifted) {
        await movement.update(
          {
            balance_quantity: nextState.balance_quantity,
            resulting_average_cost: nextState.resulting_average_cost,
            total_stock_value: nextState.total_stock_value,
          } as Partial<StockMovementAttributes>,
          { transaction },
        );
      }
    }

    await this.syncProductAverageCostConfig(
      productId,
      unitBusinessId,
      transaction,
    );

    return [
      ...baseline,
      ...protectedAfterCutoff,
      ...created,
      ...toUpdate.map((u) => u.movement),
    ].sort(
      (a, b) =>
        new Date(a.movement_date).getTime() -
        new Date(b.movement_date).getTime(),
    );
  }

  /**
   * Processamento em tempo real de UM movimento novo (fluxo normal do
   * sistema quando uma NF é emitida/confirmada). manual_average_cost_value
   * nunca é setado aqui — fica NULL até alguém setar manualmente depois.
   */
  async processMovement(
    input: ReindexProductPayload & { unit_business_id: string },
    transaction?: Transaction,
  ): Promise<StockMovement> {
    const cutoff = await this.getAutomaticSyncCutoff(
      input.product_id,
      input.unit_business_id,
      transaction,
    );
    if (cutoff && new Date(input.movement_date).getTime() <= cutoff.getTime()) {
      throw new Error(
        `[STOCK_MOVEMENT] Movimento emitido em ${new Date(input.movement_date).toISOString()} já está coberto pelo CSV extraído em ${cutoff.toISOString()}.`,
      );
    }

    const lastMovement = await this.repository.findLastMovement(
      input.product_id,
      input.unit_business_id,
      transaction,
    );

    const nextState = this.calculateNextState(
      lastMovement
        ? {
            balance_quantity: Number(lastMovement.balance_quantity),
            resulting_average_cost: Number(lastMovement.resulting_average_cost),
          }
        : null,
      input,
    );

    const payload: StockMovementCreationAttributes = {
      ...input,
      is_active: true,
      status: "PENDING",
      ...nextState,
    } as StockMovementCreationAttributes;

    await this.syncProductAverageCostConfig(
      input.product_id,
      input.unit_business_id,
      transaction,
    );

    return this.repository.create(payload, { transaction } as any);
  }

  /**
   * ⚠️ FUNÇÃO BRUTA — apaga de verdade (hard delete) todo o histórico
   * "reconstruível" do produto e recria do zero a partir de `movements`.
   *
   * NÃO deve ser chamada por nenhum fluxo automático do sistema
   * (processMovement / syncProductStockMovements). Só deve ser acionada via
   * rota de controller, sob ação explícita de um operador.
   *
   * Exceção: MANUAL_ADJUSTMENT com refers_to preenchido (correção de custo
   * ancorada numa nota fiscal específica) nunca é apagado nem recriado. Ele
   * fica intocado na timeline, servindo só de base (previousState) pro que
   * vem depois.
   *
   * Linhas protegidas mas desativadas (is_active = false) são preservadas
   * do delete, porém NÃO entram na timeline de cálculo (um ajuste manual
   * desativado não deve afetar saldo/custo médio).
   */
  async reindexProduct(
    productId: string,
    unitBusinessId: string,
    movements?: ReindexProductPayload[],
    transaction?: Transaction,
    preserveCsvBaseline = true,
  ): Promise<StockMovement[]> {
    // activeOnly = false: reindex precisa enxergar tudo, inclusive
    // inativos, pra não apagar por engano uma linha protegida desativada.
    const existingMovements = await this.repository.findHistoryByProduct(
      productId,
      unitBusinessId,
      { transaction, activeOnly: false },
    );
    const cutoff = preserveCsvBaseline
      ? await this.getAutomaticSyncCutoff(
          productId,
          unitBusinessId,
          transaction,
          existingMovements,
        )
      : null;
    const isAfterCutoff = (date: Date) =>
      !cutoff || new Date(date).getTime() > cutoff.getTime();
    const incomingSource =
      movements ??
      (await this.findStockMovementSourceData(
        unitBusinessId,
        productId,
        transaction,
        cutoff,
      ));

    // A baseline CSV não participa da reconstrução automática. Ela fornece
    // somente o estado inicial da cauda que ainda é responsabilidade do
    // sistema, sem ser apagada ou recalculada.
    const baselineMovements = existingMovements.filter(
      (movement) => !isAfterCutoff(new Date(movement.movement_date)),
    );
    const mutableExistingMovements = existingMovements.filter((movement) =>
      isAfterCutoff(new Date(movement.movement_date)),
    );

    const isProtected = (m: StockMovement) => m.refers_to != null;

    const protectedMovements = mutableExistingMovements.filter(isProtected);
    const deletableMovements = mutableExistingMovements.filter(
      (movement) => !isProtected(movement),
    );

    const incomingMovements = incomingSource.filter((movement) =>
      isAfterCutoff(new Date(movement.movement_date)),
    );

    // Só linhas protegidas ATIVAS entram na timeline de cálculo — as
    // desativadas ficam preservadas no banco, mas fora da cadeia.
    const activeProtectedMovements = protectedMovements.filter(
      (m) => m.is_active,
    );

    type TimelineEntry =
      | { kind: "protected"; date: Date; movement: StockMovement }
      | { kind: "incoming"; date: Date; movement: ReindexProductPayload };

    const timeline: TimelineEntry[] = [
      ...activeProtectedMovements.map((movement) => ({
        kind: "protected" as const,
        date: new Date(movement.movement_date),
        movement,
      })),
      ...incomingMovements.map((movement) => ({
        kind: "incoming" as const,
        date: new Date(movement.movement_date),
        movement,
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    const activeBaselineMovements = [...baselineMovements]
      .filter((movement) => movement.is_active)
      .sort(
        (a, b) =>
          new Date(a.movement_date).getTime() -
          new Date(b.movement_date).getTime(),
      );
    const lastBaseline =
      activeBaselineMovements[activeBaselineMovements.length - 1];
    let previousState: BalanceState | null = lastBaseline
      ? {
          balance_quantity: Number(lastBaseline.balance_quantity),
          resulting_average_cost: Number(lastBaseline.resulting_average_cost),
        }
      : null;
    const toCreate: StockMovementCreationAttributes[] = [];

    for (const entry of timeline) {
      if (entry.kind === "protected") {
        // Linha intocada: só empresta o estado já gravado nela pro próximo
        // elo da cadeia — nunca é recalculada aqui.
        previousState = {
          balance_quantity: Number(entry.movement.balance_quantity),
          resulting_average_cost: Number(entry.movement.resulting_average_cost),
        };
        continue;
      }

      const movement = entry.movement;
      const nextState = this.calculateNextState(previousState, {
        ...movement,
        manual_average_cost_value: movement.manual_average_cost_value ?? null,
      });

      toCreate.push({
        unit_business_id: unitBusinessId,
        product_id: productId,
        invoice_id: movement.invoice_id,
        invoice_number: movement.invoice_number,
        movement_type: movement.movement_type,
        movement_date: movement.movement_date,
        movement_quantity: movement.movement_quantity,
        unit_cost_invoice: movement.unit_cost_invoice,
        direction: (movement as any).direction ?? null,
        manual_average_cost_value: movement.manual_average_cost_value ?? null,
        status: "PENDING",
        is_active: true,
        ...nextState,
      } as StockMovementCreationAttributes);

      previousState = {
        balance_quantity: nextState.balance_quantity,
        resulting_average_cost: nextState.resulting_average_cost,
      };
    }

    if (deletableMovements.length > 0) {
      await this.repository.bulkDelete({
        where: { id: { [Op.in]: deletableMovements.map((m) => m.id) } },
        transaction,
      });
    }

    const created = toCreate.length
      ? await this.repository.bulkCreate(toCreate as any, { transaction })
      : [];

    await this.syncProductAverageCostConfig(
      productId,
      unitBusinessId,
      transaction,
    );

    return [...baselineMovements, ...protectedMovements, ...created].sort(
      (a, b) =>
        new Date(a.movement_date).getTime() -
        new Date(b.movement_date).getTime(),
    );
  }

  /**
   * Recalcula e grava a cadeia de saldo/custo médio do produto SEM apagar
   * nada. Só enxerga movimentos ATIVOS (repository já filtra is_active por
   * padrão) — os desativados somem da cadeia como se nunca tivessem
   * existido.
   *
   * MANUAL_ADJUSTMENT participa normalmente da cadeia (soma/subtrai do
   * saldo via `direction`, pode sobrescrever o custo médio via
   * manual_average_cost_value) — e, diferente de reindexProduct, a própria
   * linha AQUI é recalculada (balance_quantity/resulting_average_cost/
   * total_stock_value) a cada passagem, via calculateNextState, usando o
   * manual_average_cost_value atualmente gravado nela. Isso é essencial
   * pra updateManualAverageCost funcionar: sem recalcular a própria linha,
   * um novo override gravado nunca chegaria a aparecer no
   * resulting_average_cost (nem se propagaria pros movimentos seguintes).
   * O que NUNCA é alterado aqui é o "fato" do ajuste manual em si
   * (movement_quantity, direction, movement_date, invoice linkage) — só o
   * resultado calculado da cadeia. As únicas formas de alterar o fato em
   * si são updateManualAverageCost (que edita manual_average_cost_value
   * antes de chamar esta função) e deactivate/reactivateStockMovements.
   *
   * Pra linhas normais (com invoice_id): funde o que já está no banco com
   * os movimentos novos recebidos (`incomingMovements`) por invoice_id —
   * update se já existe, create se não existe.
   */
  async upsertProductStockMovements(
    productId: string,
    unitBusinessId: string,
    incomingMovements: ReindexProductPayload[],
    transaction?: Transaction,
    ignoreCutoff = false,
  ): Promise<StockMovement[]> {
    const existingMovements = await this.repository.findHistoryByProduct(
      productId,
      unitBusinessId,
      { transaction },
    );

    const cutoff = ignoreCutoff
      ? null
      : await this.getAutomaticSyncCutoff(
          productId,
          unitBusinessId,
          transaction,
          existingMovements,
        );
    const isAfterCutoff = (date: Date) =>
      !cutoff || new Date(date).getTime() > cutoff.getTime();

    // A parte consolidada pelo CSV é imutável para fluxos automáticos. Só a
    // cauda posterior é fundida/recalculada, usando o último estado
    // consolidado como ponto de partida.
    const baselineMovements = existingMovements.filter(
      (movement) => !isAfterCutoff(new Date(movement.movement_date)),
    );
    const lastBaseline = baselineMovements[baselineMovements.length - 1];
    const mutableMovements = existingMovements.filter((movement) =>
      isAfterCutoff(new Date(movement.movement_date)),
    );
    const eligibleIncomingMovements = incomingMovements.filter((movement) =>
      isAfterCutoff(new Date(movement.movement_date)),
    );

    const manualAdjustments = mutableMovements.filter(
      (m) => m.movement_type === "MANUAL_ADJUSTMENT",
    );
    const invoiceBackedExisting = mutableMovements.filter(
      (m) => m.movement_type !== "MANUAL_ADJUSTMENT",
    );

    const existingByInvoiceId = new Map<string, StockMovement>();
    for (const m of invoiceBackedExisting) {
      existingByInvoiceId.set(m.invoice_id as string, m);
    }

    const mergedByInvoiceId = new Map<string, ReindexProductPayload>();
    for (const existing of invoiceBackedExisting) {
      mergedByInvoiceId.set(existing.invoice_id as string, {
        product_id: productId,
        invoice_id: existing.invoice_id as string | null,
        invoice_number: existing.invoice_number,
        movement_type: existing.movement_type,
        movement_date: existing.movement_date,
        movement_quantity: Number(existing.movement_quantity),
        unit_cost_invoice:
          existing.unit_cost_invoice != null
            ? Number(existing.unit_cost_invoice)
            : undefined,
      });
    }
    for (const incoming of eligibleIncomingMovements) {
      if (!incoming.invoice_id) continue;

      mergedByInvoiceId.set(incoming.invoice_id, incoming);
    }

    type TimelineEntry =
      | { kind: "manual"; date: Date; movement: StockMovement }
      | { kind: "regular"; date: Date; payload: ReindexProductPayload };

    const timeline: TimelineEntry[] = [
      ...manualAdjustments.map((movement) => ({
        kind: "manual" as const,
        date: new Date(movement.movement_date),
        movement,
      })),
      ...[...mergedByInvoiceId.values()].map((payload) => ({
        kind: "regular" as const,
        date: new Date(payload.movement_date),
        payload,
      })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());

    let previousState: BalanceState | null = lastBaseline
      ? {
          balance_quantity: Number(lastBaseline.balance_quantity),
          resulting_average_cost: Number(lastBaseline.resulting_average_cost),
        }
      : null;
    const results: StockMovement[] = [];

    for (const entry of timeline) {
      if (entry.kind === "manual") {
        const movement = entry.movement;

        // Recalcula a PRÓPRIA linha manual a cada passagem — é o que faz
        // um manual_average_cost_value recém-gravado (via
        // updateManualAverageCost) efetivamente aparecer no
        // resulting_average_cost e se propagar pra frente na cadeia.
        // O "fato" do movimento (quantidade/direção/data) nunca muda aqui,
        // só o resultado calculado.
        const direction = movement.direction as "IN" | "OUT" | null;
        if (direction == null && movement.movement_quantity > 0) {
          throw new Error(
            `[STOCK_MOVEMENT] MANUAL_ADJUSTMENT ${movement.id} sem direction definida — dado corrompido, não é seguro recalcular.`,
          );
        }
        const nextState = this.calculateNextState(previousState, {
          movement_type: "MANUAL_ADJUSTMENT",
          movement_quantity: Number(movement.movement_quantity),
          manual_average_cost_value:
            (movement.manual_average_cost_value ?? 0) > 0 ||
            movement.manual_average_cost_value != null
              ? Number(movement.manual_average_cost_value)
              : null,
          direction,
        });

        const hasDrifted =
          Number(movement.balance_quantity) !== nextState.balance_quantity ||
          Number(movement.resulting_average_cost) !==
            nextState.resulting_average_cost ||
          Number(movement.total_stock_value) !== nextState.total_stock_value;

        if (hasDrifted) {
          await movement.update(
            {
              balance_quantity: nextState.balance_quantity,
              resulting_average_cost: nextState.resulting_average_cost,
              total_stock_value: nextState.total_stock_value,
            } as Partial<StockMovementAttributes>,
            { transaction },
          );
        }

        previousState = {
          balance_quantity: nextState.balance_quantity,
          resulting_average_cost: nextState.resulting_average_cost,
        };
        results.push(movement);
        continue;
      }

      const movement = entry.payload;

      if (!movement.invoice_id) {
        continue;
      }
      const existing = existingByInvoiceId.get(movement.invoice_id);

      // manual_average_cost_value é IMUTÁVEL via sistema: nunca é aceito a
      // partir do payload de origem (source de NF) — só o que já está
      // gravado no banco para esse invoice_id entra na conta.
      const manualAverageCostValue =
        (existing?.manual_average_cost_value ?? 0) > 0 ||
        existing?.manual_average_cost_value != null
          ? Number(existing!.manual_average_cost_value)
          : null;

      const nextState = this.calculateNextState(previousState, {
        ...movement,
        manual_average_cost_value: manualAverageCostValue,
      });

      if (existing) {
        await existing.update(
          {
            movement_type: movement.movement_type,
            movement_date: movement.movement_date,
            movement_quantity: movement.movement_quantity,
            unit_cost_invoice: movement.unit_cost_invoice,
            balance_quantity: nextState.balance_quantity,
            resulting_average_cost: nextState.resulting_average_cost,
            total_stock_value: nextState.total_stock_value,
            // manual_average_cost_value NUNCA é escrito aqui.
          } as Partial<StockMovementAttributes>,
          { transaction },
        );
        results.push(existing);
      } else {
        const created = await this.repository.create(
          {
            unit_business_id: unitBusinessId,
            product_id: productId,
            invoice_id: movement.invoice_id,
            invoice_number: movement.invoice_number,
            movement_type: movement.movement_type,
            movement_date: movement.movement_date,
            movement_quantity: movement.movement_quantity,
            unit_cost_invoice: movement.unit_cost_invoice,
            status: "PENDING",
            is_active: true,
            ...nextState,
          } as StockMovementCreationAttributes,
          { transaction } as any,
        );
        results.push(created);
      }

      previousState = {
        balance_quantity: nextState.balance_quantity,
        resulting_average_cost: nextState.resulting_average_cost,
      };
    }

    await this.syncProductAverageCostConfig(
      productId,
      unitBusinessId,
      transaction,
    );

    return results;
  }

  /**
   * refers_to âncora um MANUAL_ADJUSTMENT numa nota fiscal específica (via
   * invoice_number, não id — ver stock-movements.model.ts) e é o que decide
   * se a linha fica protegida contra delete/recriação em reindexProduct.
   * Só faz sentido junto de um manual_average_cost_value (é a correção de
   * custo dessa nota), e só é aceito se já existir uma PURCHASE_ENTRY com
   * esse invoice_number pro mesmo produto/unit_business — sanity check
   * contra erro de digitação.
   */
  private async validateRefersTo(
    productId: string,
    unitBusinessId: string,
    refersTo: string | null | undefined,
    manualAverageCostValue: number | null | undefined,
    transaction?: Transaction,
  ): Promise<void> {
    if (refersTo == null) return;

    if (manualAverageCostValue == null) {
      throw new Error(
        "[STOCK_MOVEMENT] refers_to só pode ser setado junto de um manual_average_cost_value.",
      );
    }

    const referencedEntry = await StockMovement.findOne({
      where: {
        product_id: productId,
        unit_business_id: unitBusinessId,
        movement_type: "PURCHASE_ENTRY",
        invoice_number: refersTo,
      },
      transaction,
    });

    if (!referencedEntry) {
      throw new Error(
        `[STOCK_MOVEMENT] refers_to="${refersTo}" não corresponde a nenhuma PURCHASE_ENTRY do produto=${productId}/unit_business=${unitBusinessId}.`,
      );
    }
  }

  /**
   * Cria um MANUAL_ADJUSTMENT — movimento sem nota fiscal de origem
   * (invoice_id = null). A direção recebida no payload (PURCHASE_ENTRY =
   * entra, SALE_OUT = sai) só decide o sinal da soma no saldo; o
   * movement_type gravado é SEMPRE "MANUAL_ADJUSTMENT".
   *
   * Depois de criar, recalcula a cadeia inteira a partir dali via
   * upsertProductStockMovements (sem incoming novo — só re-encadeia o que
   * já existe, agora contando com o ajuste recém-criado). Isso cobre tanto
   * o caso "adicionado no fim" quanto o retroativo (movement_date no meio
   * do histórico).
   */
  async createManualAdjustment(
    productId: string,
    unitBusinessId: string,
    payload: CreateManualAdjustmentPayload,
    transaction?: Transaction,
  ): Promise<StockMovement[]> {
    const movementDate = payload.movement_date ?? new Date();
    const direction: "IN" | "OUT" =
      payload.direction_type === "SALE_OUT" ? "OUT" : "IN";

    await this.validateRefersTo(
      productId,
      unitBusinessId,
      payload.refers_to,
      payload.manual_average_cost_value,
      transaction,
    );

    const previousMovement = await this.repository.findLastMovementBefore(
      productId,
      unitBusinessId,
      movementDate,
    );

    const previousState: BalanceState | null = previousMovement
      ? {
          balance_quantity: Number(previousMovement.balance_quantity),
          resulting_average_cost: Number(
            previousMovement.resulting_average_cost,
          ),
        }
      : null;

    const nextState = this.calculateNextState(previousState, {
      movement_type: "MANUAL_ADJUSTMENT",
      movement_quantity: payload.movement_quantity,
      manual_average_cost_value: payload.manual_average_cost_value ?? null,
      direction,
    });

    await this.repository.create(
      {
        unit_business_id: unitBusinessId,
        product_id: productId,
        invoice_id: null,
        invoice_number: undefined,
        movement_type: "MANUAL_ADJUSTMENT",
        direction,
        movement_date: movementDate,
        movement_quantity: payload.movement_quantity,
        unit_cost_invoice: undefined,
        manual_average_cost_value: payload.manual_average_cost_value ?? null,
        refers_to: payload.refers_to ?? null,
        status: "PENDING",
        is_active: true,
        ...nextState,
      } as StockMovementCreationAttributes,
      { transaction } as any,
    );

    return this.upsertProductStockMovements(
      productId,
      unitBusinessId,
      [],
      transaction,
    );
  }

  /**
   * ⚠️ ÚNICO ponto do sistema que escreve em manual_average_cost_value.
   * Só deve ser chamado explicitamente via rota administrativa de
   * controller — nunca por processMovement, syncProductStockMovements ou
   * qualquer outro fluxo automático.
   *
   * Busca por `movementId` (id da própria linha) em vez de invoice_id,
   * porque MANUAL_ADJUSTMENT não tem invoice_id (é null) — assim a mesma
   * função serve tanto pra linhas de NF quanto pra ajustes manuais.
   *
   * Recalcula toda a cadeia de saldo/custo médio do produto a partir daí,
   * via upsertProductStockMovements — sem apagar nenhum registro. Como
   * upsertProductStockMovements agora recalcula a própria linha manual em
   * cada passagem (ver comentário lá), o novo manual_average_cost_value
   * setado aqui já aparece corretamente no resulting_average_cost dela e
   * se propaga pros movimentos seguintes.
   *
   * Passar `null` remove o override e volta a cadeia a usar o custo médio
   * calculado normalmente a partir desse ponto em diante.
   */
  async updateManualAverageCost(
    productId: string,
    unitBusinessId: string,
    movementId: string,
    manualAverageCostValue: number | null,
    refersTo?: string | null,
    transaction?: Transaction,
  ): Promise<StockMovement[]> {
    const movement = await StockMovement.findOne({
      where: {
        id: movementId,
        product_id: productId,
        unit_business_id: unitBusinessId,
      },
      transaction,
    });

    if (!movement) {
      throw new Error(
        `[STOCK_MOVEMENT] Movimento não encontrado (id=${movementId}, product_id=${productId}, unit_business_id=${unitBusinessId}) — não é possível setar manual_average_cost_value.`,
      );
    }

    if (movement.movement_type !== "MANUAL_ADJUSTMENT") {
      throw new Error(
        `[STOCK_MOVEMENT] Movimento ${movementId} não é MANUAL_ADJUSTMENT — não é possível setar manual_average_cost_value.`,
      );
    }

    const nextRefersTo =
      manualAverageCostValue == null
        ? null
        : (refersTo ?? movement.refers_to ?? null);

    await this.validateRefersTo(
      productId,
      unitBusinessId,
      nextRefersTo,
      manualAverageCostValue,
      transaction,
    );

    await movement.update(
      {
        manual_average_cost_value: manualAverageCostValue,
        refers_to: nextRefersTo,
      },
      { transaction },
    );

    return this.upsertProductStockMovements(
      productId,
      unitBusinessId,
      [],
      transaction,
    );
  }

  /**
   * Marca is_active = false em lote pros ids enviados (escopado ao
   * produto/unit_business) e recalcula a cadeia a partir dali — os
   * movimentos desativados somem do saldo/custo médio como se nunca
   * tivessem existido. Funciona tanto pra movimentos normais quanto pra
   * MANUAL_ADJUSTMENT.
   */
  async deactivateStockMovements(
    productId: string,
    unitBusinessId: string,
    movementIds: string[],
    transaction?: Transaction,
  ): Promise<StockMovement[]> {
    await this.repository.setActiveStatus(
      movementIds,
      productId,
      unitBusinessId,
      false,
      transaction,
    );

    return this.upsertProductStockMovements(
      productId,
      unitBusinessId,
      [],
      transaction,
    );
  }

  /**
   * Inverso do deactivate: marca is_active = true em lote e recalcula a
   * cadeia — os movimentos voltam a contar pro saldo/custo médio.
   */
  async reactivateStockMovements(
    productId: string,
    unitBusinessId: string,
    movementIds: string[],
    transaction?: Transaction,
  ): Promise<StockMovement[]> {
    await this.repository.setActiveStatus(
      movementIds,
      productId,
      unitBusinessId,
      true,
      transaction,
    );

    return this.upsertProductStockMovements(
      productId,
      unitBusinessId,
      [],
      transaction,
    );
  }

  /**
   * Busca as NFs relevantes do Kardex
   */
  async findStockMovementSourceData(
    unitBusinessId: string,
    productId: string,
    transaction?: Transaction,
    emittedAfter?: Date | null,
  ): Promise<ListSourceDataFromInvoices[]> {
    const unitBusiness = await UnitBusiness.findByPk(unitBusinessId, {
      transaction,
    });

    if (!unitBusiness) {
      throw new Error("Unit business não encontrada!");
    }

    const unitBusinessCnpj = unitBusiness.cnpj;

    const invoiceItems = await invoiceItemsService.findAll({
      where: { product_id: productId },
      transaction,
    });

    if (!invoiceItems.length) return [];

    const invoiceIds = [
      ...new Set(invoiceItems.map((item) => item.invoice_id)),
    ];

    const invoiceWhere: any = { id: { [Op.in]: invoiceIds } };
    if (emittedAfter) {
      invoiceWhere.emitted_at = { [Op.gt]: emittedAfter };
    }

    const invoices = await Invoice.findAll({
      where: invoiceWhere,
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          required: true,
          where: {
            unit_business_id: unitBusinessId,
            status: { [Op.notIn]: ["CANCELLED", "PENDING_CANCELLED_SYSTEM"] },
          },
        },
      ],
      transaction,
    });

    if (!invoices.length) return [];

    const validInvoices = invoices.filter((invoice) => {
      if (!invoice.emitted_at) {
        console.warn(
          `[STOCK_MOVEMENT] Invoice ${invoice.id} ignorada: sem emitted_at.`,
        );
        return false;
      }
      return true;
    });

    if (!validInvoices.length) return [];

    const validInvoiceIds = validInvoices.map((inv) => inv.id);

    const fiscalItems = await InvoiceFiscalItem.findAll({
      where: {
        invoice_id: { [Op.in]: validInvoiceIds },
        product_id: productId,
      },
      transaction,
    });

    const fiscalItemsMap = new Map<string, InvoiceFiscalItem>();
    for (const fi of fiscalItems) {
      fiscalItemsMap.set(fi.invoice_id, fi);
    }

    const invoiceItemsByInvoice = new Map<string, InvoiceItems[]>();
    for (const item of invoiceItems) {
      if (!validInvoiceIds.includes(item.invoice_id)) continue;
      const list = invoiceItemsByInvoice.get(item.invoice_id) ?? [];
      list.push(item);
      invoiceItemsByInvoice.set(item.invoice_id, list);
    }

    const result: ListSourceDataFromInvoices[] = [];

    for (const invoice of validInvoices) {
      const myUba = invoice.unitBusinessAttributes?.find(
        (uba) => uba.unit_business_id === unitBusinessId,
      );

      if (!myUba) continue;

      let movementType: StockMovementType;

      if (myUba.type === "OUTGOING") {
        movementType = "SALE_OUT";
      } else if (myUba.type === "INCOMING") {
        const isReturn = invoice.sender_cnpj === unitBusinessCnpj;
        movementType = isReturn ? "CUSTOMER_RETURN" : "PURCHASE_ENTRY";
      } else {
        continue;
      }

      const items = invoiceItemsByInvoice.get(invoice.id) ?? [];

      for (const item of items) {
        const fiscalItem = fiscalItemsMap.get(invoice.id);
        const hasAcquisitionCost =
          fiscalItem?.acquisition_unit_cost !== null &&
          fiscalItem?.acquisition_unit_cost !== undefined;

        const hasUnitPrice =
          fiscalItem?.unit_price !== null &&
          fiscalItem?.unit_price !== undefined;

        if (
          movementType === "PURCHASE_ENTRY" &&
          !hasAcquisitionCost &&
          !hasUnitPrice
        ) {
          console.warn(
            `[STOCK_MOVEMENT] Item ignorado (invoice=${invoice.id}, product=${productId}): PURCHASE_ENTRY sem custo definido.`,
          );
          continue;
        }

        let unitCost = 0;

        if (fiscalItem) {
          unitCost =
            Number(fiscalItem.acquisition_unit_cost) ||
            Number(fiscalItem.unit_price) ||
            0;
        }

        result.push({
          product_id: item.product_id,
          movement_type: movementType,
          movement_quantity: Number(item.quantity_expected),
          unit_cost_invoice: unitCost,
          movement_date: invoice.emitted_at as Date,
          invoice_id: invoice.id,
          invoice_number: invoice.number_system,
        });
      }
    }

    return result;
  }

  /**
   * Sincroniza o Kardex.
   *
   * Fluxo normal (NF nova, data >= último movimento): cria em sequência,
   * sem tocar em nada existente.
   *
   * Fluxo retroativo (NF pendente com data anterior ao último movimento já
   * processado): chama upsertProductStockMovements, que recalcula a cadeia
   * e faz UPDATE/CREATE ponto a ponto, sem apagar histórico —
   * reindexProduct fica reservado só pra acionamento manual via controller.
   *
   * `actualQuantity`, se informado (saldo real vindo da Bling), roda por
   * ÚLTIMO — depois de processar todas as NFs pendentes — e reconcilia
   * qualquer diferença residual (vendas ainda sem nota, estoque inicial
   * não documentado, etc.) via MANUAL_ADJUSTMENT, preservando o custo
   * médio vigente.
   */
  async syncProductStockMovements(
    productId: string,
    unitBusinessId: string,
    actualQuantity?: number,
    transaction?: Transaction,
  ): Promise<{
    average_cost: number;
    created: number;
    balance_quantity: number;
  }> {
    const existingMovements = await this.repository.findHistoryByProduct(
      productId,
      unitBusinessId,
      { transaction },
    );
    const cutoff = await this.getAutomaticSyncCutoff(
      productId,
      unitBusinessId,
      transaction,
      existingMovements,
    );
    const sourceData = await this.findStockMovementSourceData(
      unitBusinessId,
      productId,
      transaction,
      cutoff,
    );

    const lastExisting =
      existingMovements[existingMovements.length - 1] ?? null;

    let averageCost = lastExisting
      ? Number(lastExisting.resulting_average_cost)
      : 0;
    let balanceQuantity = lastExisting
      ? Number(lastExisting.balance_quantity)
      : 0;
    let created = 0;

    const existingInvoiceIds = new Set(
      existingMovements
        .map((movement) => movement.invoice_id)
        .filter((invoiceId): invoiceId is string => !!invoiceId),
    );

    // As NFs consolidadas pelo CSV são propositalmente gravadas sem
    // invoice_id. Quando a NF correspondente chegar pelo fluxo normal, ela
    // não pode gerar um segundo movimento PENDING. O número só é usado para
    // esse caso SYNCHED e não para MANUAL_ADJUSTMENT (pedido de venda pode
    // reutilizar a mesma numeração de uma NF).
    const synchedInvoiceNumbers = new Set(
      existingMovements
        .filter(
          (movement) =>
            movement.status === "SYNCHED" &&
            movement.movement_type !== "MANUAL_ADJUSTMENT" &&
            !movement.invoice_id,
        )
        .map((movement) => normalizeInvoiceNumber(movement.invoice_number))
        .filter((invoiceNumber): invoiceNumber is string => !!invoiceNumber),
    );
    const pending = sourceData.filter(
      (item) =>
        (!item.invoice_id || !existingInvoiceIds.has(item.invoice_id)) &&
        !synchedInvoiceNumbers.has(
          normalizeInvoiceNumber(item.invoice_number) ?? "",
        ),
    );

    if (pending.length) {
      const sortedPending = [...pending].sort(
        (a, b) => a.movement_date.getTime() - b.movement_date.getTime(),
      );

      const isRetroactive =
        !!lastExisting &&
        sortedPending[0].movement_date.getTime() <
          new Date(lastExisting.movement_date).getTime();

      if (isRetroactive) {
        console.warn(
          `[STOCK_MOVEMENT] Produto ${productId}: NF pendente com data anterior ao último movimento registrado. Recalculando via upsert (sem apagar histórico).`,
        );

        const upserted = await this.upsertProductStockMovements(
          productId,
          unitBusinessId,
          sortedPending,
          transaction,
        );

        const last = upserted[upserted.length - 1];
        averageCost = last ? Number(last.resulting_average_cost) : averageCost;
        balanceQuantity = last
          ? Number(last.balance_quantity)
          : balanceQuantity;
        created = sortedPending.length;
      } else {
        let previousState: BalanceState | null = lastExisting
          ? {
              balance_quantity: Number(lastExisting.balance_quantity),
              resulting_average_cost: Number(
                lastExisting.resulting_average_cost,
              ),
            }
          : null;

        const toCreate: StockMovementCreationAttributes[] = [];

        for (const movement of sortedPending) {
          const nextState = this.calculateNextState(previousState, movement);

          toCreate.push({
            unit_business_id: unitBusinessId,
            product_id: productId,
            invoice_id: movement.invoice_id,
            invoice_number: movement.invoice_number,
            movement_type: movement.movement_type,
            movement_date: movement.movement_date,
            movement_quantity: movement.movement_quantity,
            unit_cost_invoice: movement.unit_cost_invoice,
            status: "PENDING",
            is_active: true,
            ...nextState,
          } as StockMovementCreationAttributes);

          previousState = nextState;
        }

        const createdMovements = await this.repository.bulkCreate(
          toCreate as any,
          { transaction },
        );

        averageCost = previousState!.resulting_average_cost;
        balanceQuantity = previousState!.balance_quantity;
        created = createdMovements.length;
      }
    }

    // Reconciliação por último, sempre — mesmo sem pendências, o saldo
    // pode ter divergido (venda física sem nota ainda, ajuste de
    // inventário na Bling, etc.).
    if (actualQuantity != null) {
      const reconciled = await this.reconcileProductBalance(
        productId,
        unitBusinessId,
        actualQuantity,
        transaction,
      );

      if (reconciled) {
        const last = reconciled[reconciled.length - 1];
        averageCost = Number(last.resulting_average_cost);
        balanceQuantity = Number(last.balance_quantity);
      }
    }

    await this.syncProductAverageCostConfig(
      productId,
      unitBusinessId,
      transaction,
    );

    return {
      average_cost: averageCost,
      created,
      balance_quantity: balanceQuantity,
    };
  }

  async getProductHistory(
    productId: string,
    unitBusinessId: string,
    params?: QueryParams,
  ): Promise<PaginatedResult<StockMovement>> {
    return this.repository.findHistoryByProductPaginated(
      productId,
      unitBusinessId,
      { params },
    );
  }

  async getCurrentBalance(
    productId: string,
    unitBusinessId: string,
  ): Promise<StockMovement | null> {
    return this.repository.findLastMovement(productId, unitBusinessId);
  }

  /**
   * Varre todos os produtos de UM unit_business e cria os stock_movements
   * que estão faltando (NFs sem movimento correspondente).
   *
   * Não mexe em nada que já existe — só detecta o que falta (por
   * invoice_id) e delega pro upsertProductStockMovements, que já sabe
   * inserir no ponto certo da timeline e recalcular a cadeia de
   * saldo/custo médio a partir dali.
   *
   * Uso: job de manutenção/backfill, não faz parte do fluxo automático
   * (emissão de NF continua usando processMovement/syncProductStockMovements).
   */
  async syncAllProductsStockMovements(
    unitBusinessId: string,
    transaction?: Transaction,
  ): Promise<{ product_id: string; created: number }[]> {
    const unitBusiness = await UnitBusiness.findByPk(unitBusinessId, {
      transaction,
    });

    if (!unitBusiness) {
      throw new Error("Unit business não encontrada!");
    }

    const cutoff = await this.getLatestCsvExtractionDate(transaction);

    const invoiceAttrs = await InvoiceUnitBusinessAttributes.findAll({
      where: {
        unit_business_id: unitBusinessId,
        status: { [Op.notIn]: ["CANCELLED", "PENDING_CANCELLED_SYSTEM"] },
      },
      transaction,
    });

    const invoiceIds = invoiceAttrs.map((a) => a.invoice_id);
    if (!invoiceIds.length) return [];

    // Não percorre itens de NFs que já pertencem ao CSV consolidado. A
    // filtragem é repetida no backfill por produto como defesa adicional.
    const invoices = await Invoice.findAll({
      where: {
        id: { [Op.in]: invoiceIds },
        ...(cutoff ? { emitted_at: { [Op.gt]: cutoff } } : {}),
      },
      attributes: ["id"],
      transaction,
    });
    const eligibleInvoiceIds = invoices.map((invoice) => invoice.id);
    if (!eligibleInvoiceIds.length) return [];

    const invoiceItems = await InvoiceItems.findAll({
      where: { invoice_id: { [Op.in]: eligibleInvoiceIds } },
      transaction,
    });

    const productIds = [...new Set(invoiceItems.map((i) => i.product_id))];

    const results: { product_id: string; created: number }[] = [];

    for (const productId of productIds) {
      const created = await this.backfillProductStockMovements(
        productId,
        unitBusinessId,
        transaction,
      );

      if (created > 0) {
        results.push({ product_id: productId, created });
      }
    }

    return results;
  }

  /**
   * Backfill de UM produto: acha as NFs que ainda não têm stock_movement
   * (comparando por invoice_id) e chama upsertProductStockMovements só com
   * elas. Retorna quantos movimentos foram criados.
   *
   * activeOnly = false ao buscar o histórico existente: se uma NF já tem
   * movimento só que desativado, isso conta como "já existe" — não deve
   * ser recriado.
   */
  private async backfillProductStockMovements(
    productId: string,
    unitBusinessId: string,
    transaction?: Transaction,
  ): Promise<number> {
    const existingMovements = await this.repository.findHistoryByProduct(
      productId,
      unitBusinessId,
      { transaction, activeOnly: false },
    );
    const cutoff = await this.getAutomaticSyncCutoff(
      productId,
      unitBusinessId,
      transaction,
      existingMovements,
    );
    const sourceData = await this.findStockMovementSourceData(
      unitBusinessId,
      productId,
      transaction,
      cutoff,
    );

    if (!sourceData.length) return 0;

    const existingInvoiceIds = new Set(
      existingMovements
        .filter((m) => m.invoice_id != null)
        .map((m) => m.invoice_id as string),
    );

    const missing = sourceData.filter(
      (item) =>
        item.invoice_id != null && !existingInvoiceIds.has(item.invoice_id),
    );

    if (!missing.length) return 0;

    await this.upsertProductStockMovements(
      productId,
      unitBusinessId,
      missing,
      transaction,
    );

    return missing.length;
  }

  /**
   * SYNC MANUAL — só deve ser chamada pela rota que o FRONT aciona
   * explicitamente. NUNCA por job/fluxo automático (esse continua sendo
   * syncAllProductsStockMovements / syncProductStockMovements).
   *
   * Ignora completamente o cutoff do CSV: varre TODAS as NFs do produto e
   * cria só as que ainda não têm NENHUM stock_movement correspondente,
   * verificado por invoice_number normalizado (cobre SYNCHED e PENDING,
   * com ou sem invoice_id) — e por invoice_id como checagem extra de
   * segurança. Não apaga nem modifica nada existente.
   */
  private async manualBackfillProductStockMovements(
    productId: string,
    unitBusinessId: string,
    transaction?: Transaction,
  ): Promise<number> {
    const existingMovements = await this.repository.findHistoryByProduct(
      productId,
      unitBusinessId,
      { transaction, activeOnly: false },
    );

    // Sem cutoff: queremos todas as NFs do produto, sem exceção.
    const sourceData = await this.findStockMovementSourceData(
      unitBusinessId,
      productId,
      transaction,
      null,
    );

    if (!sourceData.length) return 0;

    const existingInvoiceNumbers = new Set(
      existingMovements
        .map((m) => normalizeInvoiceNumber(m.invoice_number))
        .filter((n): n is string => !!n && n !== "0"),
    );
    const existingInvoiceIds = new Set(
      existingMovements
        .filter((m) => m.invoice_id != null)
        .map((m) => m.invoice_id as string),
    );

    const missing = sourceData.filter((item) => {
      const normalized = normalizeInvoiceNumber(item.invoice_number);
      const alreadyByNumber =
        normalized != null &&
        normalized !== "0" &&
        existingInvoiceNumbers.has(normalized);
      const alreadyById =
        item.invoice_id != null && existingInvoiceIds.has(item.invoice_id);

      return !alreadyByNumber && !alreadyById;
    });

    if (!missing.length) return 0;

    await this.upsertProductStockMovements(
      productId,
      unitBusinessId,
      missing,
      transaction,
      true,
    );

    return missing.length;
  }

  /**
   * Varre todos os produtos de UM unit_business e faz backfill manual
   * (sem cutoff) das NFs que faltam. Rota exclusiva do front — não plugar
   * em nenhum job/scheduler.
   */
  async manualSyncAllProductsStockMovements(
    unitBusinessId: string,
    transaction?: Transaction,
  ): Promise<{ product_id: string; created: number }[]> {
    const unitBusiness = await UnitBusiness.findByPk(unitBusinessId, {
      transaction,
    });

    if (!unitBusiness) {
      throw new Error("Unit business não encontrada!");
    }

    // Sem filtro de cutoff: pega todas as invoices ativas do unit_business.
    const invoiceAttrs = await InvoiceUnitBusinessAttributes.findAll({
      where: {
        unit_business_id: unitBusinessId,
        status: { [Op.notIn]: ["CANCELLED", "PENDING_CANCELLED_SYSTEM"] },
      },
      transaction,
    });

    const invoiceIds = invoiceAttrs.map((a) => a.invoice_id);
    if (!invoiceIds.length) return [];

    const invoices = await Invoice.findAll({
      where: { id: { [Op.in]: invoiceIds } },
      attributes: ["id"],
      transaction,
    });
    if (!invoices.length) return [];

    const invoiceItems = await InvoiceItems.findAll({
      where: { invoice_id: { [Op.in]: invoices.map((i) => i.id) } },
      transaction,
    });

    const productIds = [...new Set(invoiceItems.map((i) => i.product_id))];

    const results: { product_id: string; created: number }[] = [];

    for (const productId of productIds) {
      const created = await this.manualBackfillProductStockMovements(
        productId,
        unitBusinessId,
        transaction,
      );

      if (created > 0) {
        results.push({ product_id: productId, created });
      }
    }

    return results;
  }
}

export default new StockMovementService();
