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

export class StockMovementService extends BaseService<
  StockMovement,
  StockMovementRepository
> {
  constructor() {
    super(stockMovementRepository);
  }

  /**
   * Calcula o novo estado (saldo, CMP, valor total) a partir do estado anterior
   * e do tipo de movimento, considerando o desconto manual imutável na entrada.
   */
  private calculateNextState(
    previous: {
      balance_quantity: number;
      resulting_average_cost: number;
    } | null,
    input: Pick<
      ReindexProductPayload,
      "movement_type" | "movement_quantity" | "unit_cost_invoice" | "manual_discount_value"
    >,
  ): {
    balance_quantity: number;
    resulting_average_cost: number;
    total_stock_value: number;
  } {
    const previousQuantity = previous?.balance_quantity ?? 0;
    const previousAverageCost = previous?.resulting_average_cost ?? 0;
    const previousTotalValue = previousQuantity * previousAverageCost;

    let newQuantity: number;
    let newAverageCost: number;

    switch (input.movement_type) {
      case "PURCHASE_ENTRY": {
        newQuantity = previousQuantity + input.movement_quantity;

        // 💡 Abatimento do desconto manual por unidade no custo de entrada da nota
        const manualDiscount = input.manual_discount_value ?? 0;
        const rawUnitCost = input.unit_cost_invoice ?? 0;
        const effectiveUnitCost = Math.max(0, rawUnitCost - manualDiscount);

        if (previousQuantity <= 0) {
          newAverageCost = effectiveUnitCost;
        } else {
          const newEntryValue = input.movement_quantity * effectiveUnitCost;
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

      default:
        throw new Error(`Tipo de movimento inválido: ${input.movement_type}`);
    }

    return {
      balance_quantity: newQuantity,
      resulting_average_cost: newAverageCost,
      total_stock_value: newQuantity * newAverageCost,
    };
  }

  /**
   * Processamento em tempo real
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
      manual_discount_value: input.manual_discount_value ?? 0,
      ...nextState,
    };

    return this.repository.create(payload, { transaction } as any);
  }

  /**
   * Backfill / Re-indexação: Preserva o `manual_discount_value` gravado previamente no banco.
   */
  async reindexProduct(
    productId: string,
    unitBusinessId: string,
    movements: ReindexProductPayload[],
    transaction?: Transaction,
  ): Promise<StockMovement[]> {
    const sorted = [...movements].sort(
      (a, b) => a.movement_date.getTime() - b.movement_date.getTime(),
    );

    const existingMovements = await this.repository.findHistoryByProduct(
      productId,
      unitBusinessId,
      transaction,
    );

    const discountMap = new Map<string, number>();
    for (const m of existingMovements) {
      if (m.manual_discount_value != null) {
        discountMap.set(m.invoice_id, Number(m.manual_discount_value));
      }
    }

    let previousState: {
      balance_quantity: number;
      resulting_average_cost: number;
    } | null = null;
    const results: StockMovementCreationAttributes[] = [];

    for (const movement of sorted) {
      // Prioriza o valor enviado no payload; se não houver, recupera o que já estava salvo no banco
      const preservedDiscount =
        movement.manual_discount_value ??
        discountMap.get(movement.invoice_id) ??
        0;

      const movementWithDiscount = {
        ...movement,
        manual_discount_value: preservedDiscount,
      };

      const nextState = this.calculateNextState(previousState, movementWithDiscount);

      results.push({
        unit_business_id: unitBusinessId,
        product_id: productId,
        invoice_id: movement.invoice_id,
        invoice_number: movement.invoice_number,
        movement_type: movement.movement_type,
        movement_date: movement.movement_date,
        movement_quantity: movement.movement_quantity,
        unit_cost_invoice: movement.unit_cost_invoice,
        manual_discount_value: preservedDiscount, // mantém valor imutável
        ...nextState,
      });

      previousState = nextState;
    }

    if (existingMovements.length > 0) {
      await this.repository.bulkDelete({
        where: { product_id: productId, unit_business_id: unitBusinessId },
        transaction,
      });
    }

    return this.repository.bulkCreate(results as any, { transaction });
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
   * Sincroniza o Kardex e preserva os descontos manuais previamente inseridos no banco.
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
      !!lastExisting &&
      sortedPending[0].movement_date.getTime() <
        new Date(lastExisting.movement_date).getTime();

    if (isRetroactive) {
      console.warn(
        `[STOCK_MOVEMENT] Produto ${productId}: NF pendente com data anterior ao último movimento registrado. Executando reindexProduct.`,
      );

      const existingAsInput: ReindexProductPayload[] = existingMovements.map(
        (m) => ({
          product_id: productId,
          invoice_id: m.invoice_id,
          invoice_number: m.invoice_number,
          movement_type: m.movement_type,
          movement_date: m.movement_date,
          movement_quantity: Number(m.movement_quantity),
          unit_cost_invoice:
            m.unit_cost_invoice != null
              ? Number(m.unit_cost_invoice)
              : undefined,
          manual_discount_value:
            m.manual_discount_value != null
              ? Number(m.manual_discount_value)
              : 0,
        }),
      );

      const pendingAsInput: ReindexProductPayload[] = sortedPending.map(
        (m) => ({
          product_id: m.product_id,
          invoice_id: m.invoice_id,
          invoice_number: m.invoice_number,
          movement_type: m.movement_type,
          movement_date: m.movement_date,
          movement_quantity: m.movement_quantity,
          unit_cost_invoice: m.unit_cost_invoice,
        }),
      );

      const allMovements = [...existingAsInput, ...pendingAsInput];
      const reindexed = await this.reindexProduct(
        productId,
        unitBusinessId,
        allMovements,
        transaction,
      );
      const last = reindexed[reindexed.length - 1];

      return {
        average_cost: last ? Number(last.resulting_average_cost) : 0,
        created: sortedPending.length,
      };
    }

    let previousState: {
      balance_quantity: number;
      resulting_average_cost: number;
    } | null = lastExisting
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
        manual_discount_value: movement.manual_discount_value ?? 0,
        ...nextState,
      });

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