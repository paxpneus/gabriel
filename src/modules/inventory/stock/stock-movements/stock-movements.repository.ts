import { Op, Transaction } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import StockMovement from "./stock-movements.model";

export class StockMovementRepository extends BaseRepository<StockMovement> {
  constructor() {
    super(StockMovement);
  }

  /**
   * Busca o último movimento (mais recente) de um produto em uma unidade de negócio.
   * Base para o cálculo incremental (tempo real) do CMP.
   */
  async findLastMovement(
    productId: string,
    unitBusinessId: string,
    transaction?: Transaction,
  ): Promise<StockMovement | null> {
    return this.model.findOne({
      where: { product_id: productId, unit_business_id: unitBusinessId },
      order: [
        ["movement_date", "DESC"],
        ["created_at", "DESC"],
      ],
      transaction,
    });
  }

  /**
   * Busca o último movimento ANTERIOR a uma determinada data.
   * Usado na re-indexação retroativa, para saber de onde recalcular.
   */
  async findLastMovementBefore(
    productId: string,
    unitBusinessId: string,
    date: Date,
  ): Promise<StockMovement | null> {
    return this.model.findOne({
      where: {
        product_id: productId,
        unit_business_id: unitBusinessId,
        movement_date: { [Op.lt]: date },
      },
      order: [
        ["movement_date", "DESC"],
        ["created_at", "DESC"],
      ],
    });
  }

  /**
   * Busca todos os movimentos de um produto a partir de uma data (inclusive),
   * ordenados cronologicamente. Usado na re-indexação em lote.
   */
  async findMovementsFrom(
    productId: string,
    unitBusinessId: string,
    date: Date,
  ): Promise<StockMovement[]> {
    return this.model.findAll({
      where: {
        product_id: productId,
        unit_business_id: unitBusinessId,
        movement_date: { [Op.gte]: date },
      },
      order: [
        ["movement_date", "ASC"],
        ["created_at", "ASC"],
      ],
    });
  }

  /**
   * Remove todos os movimentos de um produto vinculados a uma invoice específica.
   * Usado quando uma NF é cancelada/editada, antes de reprocessar.
   */
  async deleteByInvoiceAndProduct(
    invoiceId: string,
    productId: string,
  ): Promise<number> {
    return this.bulkDelete({
      where: { invoice_id: invoiceId, product_id: productId },
    });
  }

  /**
   * Lista todo o histórico de um produto (ordenado ASC), usado no backfill
   * e em telas de auditoria/kardex.
   */
  async findHistoryByProduct(
    productId: string,
    unitBusinessId: string,
    transaction?: Transaction,
  ): Promise<StockMovement[]> {
    return this.model.findAll({
      where: { product_id: productId, unit_business_id: unitBusinessId },
      order: [
        ["movement_date", "ASC"],
        ["created_at", "ASC"],
      ],
      transaction
    });
  }
}

export default new StockMovementRepository();
