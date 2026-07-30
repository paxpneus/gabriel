import { Op } from "sequelize";
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
   * e do tipo de movimento, conforme a especificação do Kardex.
   */
  private calculateNextState(
    previous: {
      balance_quantity: number;
      resulting_average_cost: number;
    } | null,
    input: Pick<
      ReindexProductPayload,
      "movement_type" | "movement_quantity" | "unit_cost_invoice"
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

        if (previousQuantity <= 0) {
          // Estoque zerado (ou sem histórico): novo CMP é 100% o custo da nova NF
          newAverageCost = input.unit_cost_invoice ?? 0;
        } else {
          const newEntryValue =
            input.movement_quantity * (input.unit_cost_invoice ?? 0);
          const newTotalValue = previousTotalValue + newEntryValue;
          newAverageCost = newTotalValue / newQuantity;
        }
        break;
      }

      case "SALE_OUT": {
        newQuantity = previousQuantity - input.movement_quantity;
        newAverageCost = previousAverageCost; // mantém, mesmo se zerar
        break;
      }

      case "CUSTOMER_RETURN": {
        newQuantity = previousQuantity + input.movement_quantity;
        newAverageCost = previousAverageCost; // mantém (usa o CMP congelado, se houver)
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
   * Processamento em tempo real: busca o último movimento do produto,
   * calcula o novo estado e grava a nova linha.
   */
  async processMovement(
    input: ReindexProductPayload & { unit_business_id: string },
  ): Promise<StockMovement> {
    const lastMovement = await this.repository.findLastMovement(
      input.product_id,
      input.unit_business_id,
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
      ...nextState,
    };

    return this.repository.create(payload);
  }

  /**
   * Backfill / Re-indexação: recebe a lista de NFs (já ordenadas ASC) de um produto
   * e reprocessa sequencialmente a partir do zero, substituindo o histórico.
   */
  async reindexProduct(
    productId: string,
    unitBusinessId: string,
    movements: ReindexProductPayload[],
  ): Promise<StockMovement[]> {
    const sorted = [...movements].sort(
      (a, b) => a.movement_date.getTime() - b.movement_date.getTime(),
    );

    let previousState: {
      balance_quantity: number;
      resulting_average_cost: number;
    } | null = null;
    const results: StockMovementCreationAttributes[] = [];

    for (const movement of sorted) {
      const nextState = this.calculateNextState(previousState, movement);

      results.push({
        unit_business_id: unitBusinessId,
        product_id: productId,
        invoice_id: movement.invoice_id,
        invoice_number: movement.invoice_number,
        movement_type: movement.movement_type,
        movement_date: movement.movement_date,
        movement_quantity: movement.movement_quantity,
        unit_cost_invoice: movement.unit_cost_invoice,
        ...nextState,
      });

      previousState = nextState;
    }

    // Remove o histórico atual do produto e recria do zero
    const existing = await this.repository.findHistoryByProduct(
      productId,
      unitBusinessId,
    );
    if (existing.length > 0) {
      await this.repository.bulkDelete({
        where: { product_id: productId, unit_business_id: unitBusinessId },
      });
    }

    return this.repository.bulkCreate(results as any);
  }

  /**
   * Busca as NFs (entrada, saída, retorno) vinculadas a uma unit business E a um
   * produto específico, classifica cada uma pelo tipo de movimento e retorna os
   * itens já no formato pronto para alimentar o processamento do Kardex.
   */
  async findStockMovementSourceData(
    unitBusinessId: string,
    productId: string,
  ): Promise<ListSourceDataFromInvoices[]> {
    // ─── 1. Identifica a unit business e seu CNPJ ─────────────────────────
    const unitBusiness = await UnitBusiness.findByPk(unitBusinessId);

    if (!unitBusiness) {
      throw new Error("Unit business não encontrada!");
    }

    const unitBusinessCnpj = unitBusiness.cnpj;

    // ─── 2. Busca APENAS os invoice items desse produto ────────────────────
    const invoiceItems = await invoiceItemsService.findAll({
      where: { product_id: productId },
    });

    if (!invoiceItems.length) return [];

    const invoiceIds = [
      ...new Set(invoiceItems.map((item) => item.invoice_id)),
    ];

    // ─── 3. Busca só as invoices envolvidas, com uba da unit business filtrada ───
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

    // ─── 4. Busca os fiscal items só do produto + invoices válidas ─────────
    const fiscalItems = await InvoiceFiscalItem.findAll({
      where: {
        invoice_id: { [Op.in]: validInvoiceIds },
        product_id: productId,
      },
    });

    const fiscalItemsMap = new Map<string, InvoiceFiscalItem>();
    for (const fi of fiscalItems) {
      fiscalItemsMap.set(fi.invoice_id, fi);
    }

    // Mapa invoice_id -> itens desse produto (pode haver mais de 1 linha por invoice_id)
    const invoiceItemsByInvoice = new Map<string, InvoiceItems[]>();
    for (const item of invoiceItems) {
      if (!validInvoiceIds.includes(item.invoice_id)) continue;
      const list = invoiceItemsByInvoice.get(item.invoice_id) ?? [];
      list.push(item);
      invoiceItemsByInvoice.set(item.invoice_id, list);
    }

    // ─── 5. Classifica cada invoice e monta o resultado ────────────────────
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
        const hasUnitPrice =
          fiscalItem?.unit_price !== null &&
          fiscalItem?.unit_price !== undefined;

        if (movementType === "PURCHASE_ENTRY" && !hasUnitPrice) {
          console.warn(
            `[STOCK_MOVEMENT] Item ignorado (invoice=${invoice.id}, product=${productId}): PURCHASE_ENTRY sem unit_price.`,
          );
          continue;
        }

        const unitCost = hasUnitPrice ? Number(fiscalItem!.unit_price) : 0;

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
   * Sincroniza o Kardex de UM produto: busca as NFs relevantes, identifica quais
   * ainda não têm registro em stock_movements, cria só essas (encadeando a partir
   * do último estado salvo) e retorna o CMP resultante ao final do processamento.
   *
   * Caso alguma NF pendente seja retroativa (anterior ao último movimento já
   * gravado), delega para reindexProduct, que reprocessa o histórico inteiro
   * na ordem cronológica correta.
   */
  async syncProductStockMovements(
    productId: string,
    unitBusinessId: string,
  ): Promise<{ average_cost: number; created: number }> {
    const sourceData = await this.findStockMovementSourceData(
      unitBusinessId,
      productId,
    );

    const existingMovements = await this.repository.findHistoryByProduct(
      productId,
      unitBusinessId,
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

    // ─── Filtra só as NFs que ainda não foram registradas ───────────────────
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

    // ─── Detecta NF retroativa: pendente mais antiga que o último movimento gravado ───
    const isRetroactive =
      !!lastExisting &&
      sortedPending[0].movement_date.getTime() <
        new Date(lastExisting.movement_date).getTime();
    if (isRetroactive) {
      console.warn(
        `[STOCK_MOVEMENT] Produto ${productId}: NF pendente com data anterior ao último movimento registrado. ` +
          `Executando reindexProduct para reprocessar o histórico completo.`,
      );

      // Converte os movimentos já existentes de volta pro formato de input,
      // junta com os pendentes, e deixa o reindexProduct recalcular tudo do zero.
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
      );
      const last = reindexed[reindexed.length - 1];

      return {
        average_cost: last ? Number(last.resulting_average_cost) : 0,
        created: sortedPending.length,
      };
    }

    // ─── Caso normal: só adiciona as pendentes ao final ─────────────────────
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
        ...nextState,
      });

      previousState = nextState;
    }

    const created = await this.repository.bulkCreate(toCreate as any);

    return {
      average_cost: previousState!.resulting_average_cost,
      created: created.length,
    };
  }

  /**
   * Retorna o histórico completo (kardex) de um produto, para telas de auditoria.
   */
  async getProductHistory(
    productId: string,
    unitBusinessId: string,
  ): Promise<StockMovement[]> {
    return this.repository.findHistoryByProduct(productId, unitBusinessId);
  }

  /**
   * Retorna o saldo e CMP atuais de um produto (última linha do kardex).
   */
  async getCurrentBalance(
    productId: string,
    unitBusinessId: string,
  ): Promise<StockMovement | null> {
    return this.repository.findLastMovement(productId, unitBusinessId);
  }
}

export default new StockMovementService();
