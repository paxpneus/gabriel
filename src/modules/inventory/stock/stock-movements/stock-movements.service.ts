import { Op, Transaction } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { Invoice, InvoiceItems, UnitBusiness } from "../../../warehouse";
import InvoiceUnitBusinessAttributes from "../../../warehouse/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
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
import InvoiceFiscalItem from "../../../warehouse/invoices/invoice-fiscal-item/invoice-fiscal-item.model";
import invoiceItemsService from "../../../warehouse/invoices/invoice-items/invoice-items.service";

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
  movement_date?: Date;
};

export class StockMovementService extends BaseService<
  StockMovement,
  StockMovementRepository
> {
  constructor() {
    super(stockMovementRepository);
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

    // Override manual: substitui completamente o custo médio calculado para
    // este movimento. Ex.: resulting calculado = 500, manual = 600 → o
    // movimento fica com 600, e os próximos movimentos usam 600 como base.
    if (input.manual_average_cost_value != null) {
      newAverageCost = input.manual_average_cost_value;
    }

    return {
      balance_quantity: newQuantity,
      resulting_average_cost: newAverageCost,
      total_stock_value: newQuantity * newAverageCost,
    };
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
      ...nextState,
    } as StockMovementCreationAttributes;

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
   * Exceção: linhas PROTEGIDAS nunca são apagadas nem recriadas —
   * MANUAL_ADJUSTMENT (imutável pelo fluxo do sistema) e qualquer linha com
   * manual_average_cost_value preenchido (override manual gravado). Elas
   * ficam intocadas na timeline, servindo só de base (previousState) pro
   * que vem depois. Se a fonte trouxer de volta um invoice_id que já
   * corresponde a uma linha protegida, essa entrada da fonte é ignorada —
   * a linha protegida manda.
   *
   * Linhas protegidas mas desativadas (is_active = false) são preservadas
   * do delete, porém NÃO entram na timeline de cálculo (um ajuste manual
   * desativado não deve afetar saldo/custo médio).
   */
  async reindexProduct(
    productId: string,
    unitBusinessId: string,
    movements: ReindexProductPayload[],
    transaction?: Transaction,
  ): Promise<StockMovement[]> {
    // activeOnly = false: reindex precisa enxergar tudo, inclusive
    // inativos, pra não apagar por engano uma linha protegida desativada.
    const existingMovements = await this.repository.findHistoryByProduct(
      productId,
      unitBusinessId,
      transaction,
      false,
    );

    const isProtected = (m: StockMovement) =>
      m.movement_type === "MANUAL_ADJUSTMENT" ||
      m.manual_average_cost_value != null;

    const protectedMovements = existingMovements.filter(isProtected);
    const deletableMovements = existingMovements.filter((m) => !isProtected(m));

    const protectedInvoiceIds = new Set(
      protectedMovements
        .filter((m) => m.invoice_id != null)
        .map((m) => m.invoice_id as string | null),
    );

    const incomingMovements = movements.filter(
      (m) => !protectedInvoiceIds.has(m.invoice_id),
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

    let previousState: BalanceState | null = null;
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
        manual_average_cost_value: movement.manual_average_cost_value ?? null,
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

    return [...protectedMovements, ...created].sort(
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
   * manual_average_cost_value), mas a própria linha NUNCA sofre update
   * aqui — só empresta seu estado já gravado pro próximo elo. As únicas
   * formas de alterar essa linha são updateManualAverageCost e
   * deactivate/reactivateStockMovements.
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
  ): Promise<StockMovement[]> {
    const existingMovements = await this.repository.findHistoryByProduct(
      productId,
      unitBusinessId,
      transaction,
    );

    const manualAdjustments = existingMovements.filter(
      (m) => m.movement_type === "MANUAL_ADJUSTMENT",
    );
    const invoiceBackedExisting = existingMovements.filter(
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
    for (const incoming of incomingMovements) {
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

    let previousState: BalanceState | null = null;
    const results: StockMovement[] = [];

    for (const entry of timeline) {
      if (entry.kind === "manual") {
        previousState = {
          balance_quantity: Number(entry.movement.balance_quantity),
          resulting_average_cost: Number(entry.movement.resulting_average_cost),
        };
        results.push(entry.movement);
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
        existing?.manual_average_cost_value != null
          ? Number(existing.manual_average_cost_value)
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

    return results;
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
   * via upsertProductStockMovements — sem apagar nenhum registro.
   *
   * Passar `null` remove o override e volta a cadeia a usar o custo médio
   * calculado normalmente a partir desse ponto em diante.
   */
  async updateManualAverageCost(
    productId: string,
    unitBusinessId: string,
    movementId: string,
    manualAverageCostValue: number | null,
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

    await movement.update(
      { manual_average_cost_value: manualAverageCostValue },
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

    const invoices = await Invoice.findAll({
      where: { id: { [Op.in]: invoiceIds } },
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
   */
  async syncProductStockMovements(
    productId: string,
    unitBusinessId: string,
    transaction?: Transaction,
  ): Promise<{ average_cost: number; created: number }> {
    const sourceData = await this.findStockMovementSourceData(
      unitBusinessId,
      productId,
      transaction,
    );

    const existingMovements = await this.repository.findHistoryByProduct(
      productId,
      unitBusinessId,
      transaction,
    );

    const lastExisting =
      existingMovements[existingMovements.length - 1] ?? null;

    if (!sourceData.length) {
      return {
        average_cost: lastExisting
          ? Number(lastExisting.resulting_average_cost)
          : 0,
        created: 0,
      };
    }

    const existingInvoiceIds = new Set(
      existingMovements.map((m) => m.invoice_id),
    );
    const pending = sourceData.filter(
      (item) => !existingInvoiceIds.has(item.invoice_id),
    );

    if (!pending.length) {
      return {
        average_cost: lastExisting
          ? Number(lastExisting.resulting_average_cost)
          : 0,
        created: 0,
      };
    }

    const sortedPending = [...pending].sort(
      (a, b) => a.movement_date.getTime() - b.movement_date.getTime(),
    );

    const isRetroactive =
      !!lastExisting && sortedPending[0].movement_date.getTime();
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

      return {
        average_cost: last ? Number(last.resulting_average_cost) : 0,
        created: sortedPending.length,
      };
    }

    let previousState: BalanceState | null = lastExisting
      ? {
          balance_quantity: Number(lastExisting.balance_quantity),
          resulting_average_cost: Number(lastExisting.resulting_average_cost),
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
        is_active: true,
        ...nextState,
      } as StockMovementCreationAttributes);

      previousState = nextState;
    }

    const created = await this.repository.bulkCreate(toCreate as any, {
      transaction,
    });

    return {
      average_cost: previousState!.resulting_average_cost,
      created: created.length,
    };
  }

  async getProductHistory(
    productId: string,
    unitBusinessId: string,
  ): Promise<StockMovement[]> {
    return this.repository.findHistoryByProduct(productId, unitBusinessId);
  }

  async getCurrentBalance(
    productId: string,
    unitBusinessId: string,
  ): Promise<StockMovement | null> {
    return this.repository.findLastMovement(productId, unitBusinessId);
  }
}

export default new StockMovementService();
