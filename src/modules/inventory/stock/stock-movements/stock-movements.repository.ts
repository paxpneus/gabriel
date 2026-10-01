import { Op, QueryTypes, Transaction, WhereOptions } from "sequelize";
import sequelize from "../../../../config/sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import StockMovement from "./stock-movements.model";
import {
  PaginatedResult,
  QueryConfig,
  QueryParams,
} from "../../../../shared/query/query.types";
import { QueryParser } from "../../../../shared/query/query.parser";
import {
  buildDiscountBulkUpdate,
  buildFillMissingInvoiceValuesUpdate,
  InvoiceValueFill,
} from "./helpers/invoice-value-updates";
import {
  DiscountHistoryRow,
  PurchaseEntryDiscountFields,
} from "./helpers/purchase-entry-discount";

const DISCOUNT_HISTORY_ATTRIBUTES = [
  "id",
  "product_id",
  "movement_type",
  "direction",
  "invoice_number",
  "refers_to",
  "movement_quantity",
  "unit_cost_invoice",
  "balance_quantity",
  "resulting_average_cost",
  "total_stock_value",
];

const BULK_UPDATE_CHUNK_SIZE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export class StockMovementRepository extends BaseRepository<StockMovement> {
  constructor() {
    super(StockMovement);
  }

  /**
   * Busca o último movimento (mais recente) de um produto em uma unidade de negócio.
   * Base para o cálculo incremental (tempo real) do CMP.
   *
   * Só considera movimentos ativos (is_active = true) — um movimento
   * desativado nunca deve servir de base pra próxima movimentação.
   */
  async findLastMovement(
    productId: string,
    unitBusinessId: string,
    transaction?: Transaction,
  ): Promise<StockMovement | null> {
    return this.model.findOne({
      where: {
        product_id: productId,
        unit_business_id: unitBusinessId,
        is_active: true,
      },
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
        is_active: true,
      },
      order: [
        ["movement_date", "DESC"],
        ["created_at", "DESC"],
      ],
    });
  }

  /**
   * Busca uma movimentação do produto por invoice_number + movement_type.
   * Usado pra resolver a âncora de refers_to, que guarda o invoice_number da
   * movimentação referenciada (não o id — ver stock-movements.model.ts),
   * já que esse valor sobrevive ao delete+recriação de reindexProduct.
   */
  async findByInvoiceNumberAndType(
    productId: string,
    unitBusinessId: string,
    invoiceNumber: string,
    movementType: StockMovement["movement_type"],
    transaction?: Transaction,
  ): Promise<StockMovement | null> {
    return this.model.findOne({
      where: {
        product_id: productId,
        unit_business_id: unitBusinessId,
        invoice_number: invoiceNumber,
        movement_type: movementType,
        is_active: true,
      },
      order: [["movement_date", "ASC"]],
      transaction,
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
        is_active: true,
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
   * Lista todo o histórico de um produto (ordenado ASC), usado no backfill,
   * no cálculo da cadeia (upsert/reindex) e em telas de auditoria/kardex.
   *
   * Por padrão (`activeOnly = true`) só traz movimentos com is_active = true
   * — é o que a cadeia de cálculo e a visão padrão do front enxergam.
   * Passe `activeOnly = false` pra trazer tudo, inclusive os desativados
   * (usado quando o usuário pede explicitamente pra ver os inativos).
   */

  private buildHistoryWhere(
    productId: string,
    unitBusinessId: string,
    activeOnly: boolean,
  ): WhereOptions {
    const where: WhereOptions = {
      product_id: productId,
      unit_business_id: unitBusinessId,
    };

    if (activeOnly) {
      where.is_active = true;
    }

    return where;
  }

  private buildHistoryConfig(config: QueryConfig): QueryConfig {
    return {
      ...config,
      defaults: {
        perPage: 20,
        sortBy: ["movement_date", "created_at"],
        sortDir: "ASC",
        ...config.defaults,
      },
    };
  }

  async findHistoryByProduct(
    productId: string,
    unitBusinessId: string,
    options: {
      transaction?: Transaction;
      activeOnly?: boolean;
      config?: QueryConfig;
      params?: QueryParams;
    } = {},
  ): Promise<StockMovement[]> {
    const {
      transaction,
      activeOnly = true,
      config = {},
      params = {},
    } = options;

    const where = this.buildHistoryWhere(productId, unitBusinessId, activeOnly);
    const mergedConfig = this.buildHistoryConfig(config);

    const resolved = QueryParser.parse(params, mergedConfig);
    const finalWhere = resolved.where
      ? ({ [Op.and]: [where, resolved.where] } as WhereOptions)
      : where;

    return this.model.findAll({
      where: finalWhere,
      order: resolved.order,
      transaction,
    });
  }

  /**
   * Versão PAGINADA do histórico — uso exclusivo do front (ex.: tela de
   * Kardex). Aplica limit/offset/page vindos de `params`. Mesmo default de
   * ordenação (movement_date ASC, created_at ASC).
   *
   * Não é usado por nenhum fluxo de cálculo interno — só por
   * StockMovementService.getProductHistory.
   */
  async findHistoryByProductPaginated(
    productId: string,
    unitBusinessId: string,
    options: {
      transaction?: Transaction;
      activeOnly?: boolean;
      config?: QueryConfig;
      params?: QueryParams;
    } = {},
  ): Promise<PaginatedResult<StockMovement>> {
    const {
      transaction,
      activeOnly = true,
      config = {},
      params = {},
    } = options;

    const where = this.buildHistoryWhere(productId, unitBusinessId, activeOnly);
    const mergedConfig = this.buildHistoryConfig(config);

    return this.findPaginated(params, mergedConfig, { transaction }, where);
  }
  /**
   * Busca movimentos por id, sempre escopado a product_id + unit_business_id
   * (nunca confia só no id vindo do payload).
   */
  async findByIdsScoped(
    ids: string[],
    productId: string,
    unitBusinessId: string,
    transaction?: Transaction,
  ): Promise<StockMovement[]> {
    return this.model.findAll({
      where: {
        id: { [Op.in]: ids },
        product_id: productId,
        unit_business_id: unitBusinessId,
      },
      transaction,
    });
  }

  /**
   * Marca is_active em lote pra um conjunto de ids (escopado a
   * product_id + unit_business_id). Usado tanto pra desativar quanto pra
   * reativar — o valor de `isActive` decide qual.
   */
  async setActiveStatus(
    ids: string[],
    productId: string,
    unitBusinessId: string,
    isActive: boolean,
    transaction?: Transaction,
  ): Promise<number> {
    const [affectedCount] = await this.model.update(
      { is_active: isActive },
      {
        where: {
          id: { [Op.in]: ids },
          product_id: productId,
          unit_business_id: unitBusinessId,
        },
        transaction,
      },
    );

    return affectedCount;
  }

  /**
   * Apaga somente movimentos provisórios cobertos pelo CSV atual. A janela
   * é (cutoffDate, extractionDate]: o que é anterior já foi consolidado por
   * um CSV anterior; o que é posterior ainda não apareceu no CSV.
   *
   * Movimentos protegidos (refers_to preenchido) nunca são removidos.
   */
  async deletePendingInCsvWindow(
    productId: string,
    unitBusinessId: string,
    cutoffDate: Date | null,
    extractionDate: Date,
    transaction?: Transaction,
  ): Promise<string[]> {
    const movementDate = cutoffDate
      ? { [Op.gt]: cutoffDate, [Op.lte]: extractionDate }
      : { [Op.lte]: extractionDate };

    const candidates = await this.model.findAll({
      where: {
        product_id: productId,
        unit_business_id: unitBusinessId,
        status: "PENDING",
        refers_to: null,
        movement_date: movementDate,
        is_active: true,
      },
      transaction,
    });

    if (!candidates.length) return [];

    const ids = candidates.map((m) => m.id);
    await this.bulkDelete({ where: { id: { [Op.in]: ids } }, transaction });
    return ids;
  }

  /**
   * Busca o último movimento ativo de cada produto informado, numa única
   * precisam do "custo médio atual".
   */
  async findLastMovementsByProducts(
    productIds: string[],
    unitBusinessId: string,
    asOfDate?: Date,
    transaction?: Transaction,
  ): Promise<Map<string, StockMovement>> {
    const result = new Map<string, StockMovement>();
    if (!productIds.length) return result;

    const movements = await this.model.findAll({
      where: {
        product_id: { [Op.in]: productIds },
        unit_business_id: unitBusinessId,
        is_active: true,
        ...(asOfDate ? { movement_date: { [Op.lte]: asOfDate } } : {}),
      },
      order: [
        ["product_id", "ASC"],
        ["movement_date", "DESC"],
        ["created_at", "DESC"],
      ],
      transaction,
    });

    for (const movement of movements) {
      if (!result.has(movement.product_id)) {
        result.set(movement.product_id, movement);
      }
    }

    return result;
  }

  private isEntryLikeMovement(movement: StockMovement): boolean {
    if (movement.movement_type === "PURCHASE_ENTRY") return true;

    return (
      movement.movement_type === "MANUAL_ADJUSTMENT" &&
      movement.refers_to != null &&
      movement.manual_average_cost_value != null
    );
  }

  /**
   * Retorna as últimas `limit` movimentações "efetivas" por produto.
   *
   * REGRA DA POSIÇÃO 0 (última movimentação): precisa SEMPRE ser uma
   * PURCHASE_ENTRY ou um MANUAL_ADJUSTMENT que seja correção de custo
   * (refers_to E manual_average_cost_value preenchidos — um MANUAL_ADJUSTMENT
   * com refers_to mas sem manual_average_cost_value é um ajuste de
   * quantidade, não conta aqui). Se o topo real da timeline for qualquer
   * outro tipo, esses itens são ignorados como "última movimentação" —
   * descartamos do topo pra baixo até achar a última que seja de fato uma
   * entrada/correção válida.
   *
   * REGRA DAS DEMAIS POSIÇÕES (penúltima em diante): qualquer tipo de
   * movimentação conta, pegando exatamente o que vem antes na pilha geral
   * já colapsada (cadeias de correção de PURCHASE_ENTRY continuam
   * colapsando normalmente aqui).
   *
   * Uma cadeia de correção é: uma PURCHASE_ENTRY seguida por um ou mais
   * MANUAL_ADJUSTMENT cujo `refers_to` bate com o `invoice_number` da
   * entrada (ou com o `refers_to` da correção anterior, permitindo cadeias
   * de múltiplas correções) — cada correção substitui a anterior no topo
   * da pilha. Não há janela de tempo: o casamento é só por invoice.
   *
   * Retorna Map<product_id, StockMovement[]>, mais recente primeiro.
   */
  async findLastEffectiveMovements(
    productIds: string[],
    unitBusinessId: string,
    asOfDate?: Date,
    limit = 2,
    transaction?: Transaction,
  ): Promise<Map<string, StockMovement[]>> {
    const result = new Map<string, StockMovement[]>();
    if (!productIds.length) return result;

    const history = await this.model.findAll({
      where: {
        product_id: { [Op.in]: productIds },
        unit_business_id: unitBusinessId,
        is_active: true,
        ...(asOfDate ? { movement_date: { [Op.lte]: asOfDate } } : {}),
      },
      order: [
        ["product_id", "ASC"],
        ["movement_date", "ASC"],
        ["created_at", "ASC"],
      ],
      transaction,
    });

    type StackItem = { movement: StockMovement; invoiceKey: string | null };

    const stacksByProduct = new Map<string, StackItem[]>();

    for (const movement of history) {
      const productId = movement.product_id;
      const stack = stacksByProduct.get(productId) ?? [];
      const top = stack[stack.length - 1];

      const isCostCorrection =
        movement.movement_type === "MANUAL_ADJUSTMENT" &&
        movement.refers_to != null &&
        movement.manual_average_cost_value != null;

      if (isCostCorrection && top?.invoiceKey === movement.refers_to) {
        stack[stack.length - 1] = { movement, invoiceKey: movement.refers_to as string };
        stacksByProduct.set(productId, stack);
        continue;
      }

      stack.push({
        movement,
        invoiceKey:
          movement.movement_type === "PURCHASE_ENTRY"
            ? (movement.invoice_number ?? null)
            : isCostCorrection
              ? (movement.refers_to as string)
              : null,
      });
      stacksByProduct.set(productId, stack);
    }

    for (const [productId, stack] of stacksByProduct) {
      // acha, de trás pra frente, o último item que é entry-like —
      // esse SEMPRE precisa ser a posição 0 do resultado
      let lastEntryIndex = -1;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (this.isEntryLikeMovement(stack[i].movement)) {
          lastEntryIndex = i;
          break;
        }
      }

      // produto sem nenhuma entrada/correção válida na timeline -> ignora
      if (lastEntryIndex === -1) continue;

      const startIndex = Math.max(0, lastEntryIndex - limit + 1);

      result.set(
        productId,
        stack
          .slice(startIndex, lastEntryIndex + 1)
          .reverse()
          .map((item) => item.movement),
      );
    }

    return result;
  }
  /** Produtos com ao menos uma PURCHASE_ENTRY ativa na unidade. */
  async findProductIdsWithPurchaseEntries(
    unitBusinessId: string,
    transaction?: Transaction,
  ): Promise<string[]> {
    const rows = await this.model.findAll({
      where: {
        unit_business_id: unitBusinessId,
        movement_type: "PURCHASE_ENTRY",
        is_active: true,
      },
      attributes: ["product_id"],
      group: ["product_id"],
      order: [["product_id", "ASC"]],
      raw: true,
      transaction,
    });

    return rows.map((row) => row.product_id);
  }

  /**
   * Kardex ativo dos produtos na ordem canônica (movement_date, created_at,
   * id) — só as colunas que o cálculo de desconto usa.
   */
  async findDiscountHistoryByProducts(
    productIds: string[],
    unitBusinessId: string,
    transaction?: Transaction,
  ): Promise<Map<string, DiscountHistoryRow[]>> {
    const byProduct = new Map<string, DiscountHistoryRow[]>();
    if (!productIds.length) return byProduct;

    const rows = (await this.model.findAll({
      where: {
        product_id: { [Op.in]: productIds },
        unit_business_id: unitBusinessId,
        is_active: true,
      },
      attributes: DISCOUNT_HISTORY_ATTRIBUTES,
      order: [
        ["product_id", "ASC"],
        ["movement_date", "ASC"],
        ["created_at", "ASC"],
        ["id", "ASC"],
      ],
      raw: true,
      transaction,
    })) as unknown as (DiscountHistoryRow & { product_id: string })[];

    for (const row of rows) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push(row);
      byProduct.set(row.product_id, list);
    }

    return byProduct;
  }

  /** UPDATE em lote dos campos de desconto; retorna linhas realmente alteradas. */
  async bulkUpdateDiscountFields(
    rows: PurchaseEntryDiscountFields[],
    transaction?: Transaction,
  ): Promise<number> {
    let changed = 0;

    for (const part of chunk(rows, BULK_UPDATE_CHUNK_SIZE)) {
      const { sql, replacements } = buildDiscountBulkUpdate(part);
      const [, affected] = (await sequelize.query(sql, {
        replacements,
        type: QueryTypes.UPDATE,
        transaction,
      })) as unknown as [unknown, number];
      changed += Number(affected ?? 0);
    }

    return changed;
  }

  /** Preenche unit_price_invoice/bling_* só onde estão NULL. */
  async fillMissingInvoiceValues(
    rows: InvoiceValueFill[],
    transaction?: Transaction,
  ): Promise<number> {
    let changed = 0;

    for (const part of chunk(rows, BULK_UPDATE_CHUNK_SIZE)) {
      const { sql, replacements } = buildFillMissingInvoiceValuesUpdate(part);
      const [, affected] = (await sequelize.query(sql, {
        replacements,
        type: QueryTypes.UPDATE,
        transaction,
      })) as unknown as [unknown, number];
      changed += Number(affected ?? 0);
    }

    return changed;
  }
}

export default new StockMovementRepository();
