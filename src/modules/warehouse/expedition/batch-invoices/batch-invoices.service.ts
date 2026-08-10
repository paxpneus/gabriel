import { Op, Transaction } from "sequelize";
import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import invoiceItemsService from "../../fiscal/invoices/invoice-items/invoice-items.service";
import invoiceService from "../../fiscal/invoices/invoice/invoice.service";
import ExpeditionBatchItems from "../batch-items/batch-items.model";
import ExpeditionBatch from "../batch/batch.model";
import scanLogsService from "../scan-logs/scan-logs.service";
import ExpeditionBatchInvoice from "./batch-invoices.model";
import expeditionBatchInvoiceRepository, {
  ExpeditionBatchInvoiceRepository,
} from "./batch-invoices.repository";
import Invoice from "../../fiscal/invoices/invoice/invoice.model";
import { InvoiceItemsAttributes } from "../../fiscal/invoices/invoice-items/invoice-items.types";
import batchItemsService from "../batch-items/batch-items.service";
import batchInvoiceItemsService from "../batch-invoice-items/batch-invoice-items.service";
import { BatchInvoiceItemsCreationAttributes } from "../batch-invoice-items/batch-invoice-items.types";
import batchService from "../batch/batch.service";

export class ExpeditionBatchInvoiceService extends BaseService<
  ExpeditionBatchInvoice,
  ExpeditionBatchInvoiceRepository
> {
  constructor() {
    super(expeditionBatchInvoiceRepository);
  }

  async removeBatchInvoice(
    id: string,
    externalTransaction?: Transaction,
  ): Promise<void> {
    const run = async (t: Transaction) => {
      const batchInvoice = (await this.findById(id, {
        transaction: t,
      })) as ExpeditionBatchInvoice;

      if (!batchInvoice) {
        throw new Error(`Nota fiscal não encontrada`);
      }

      const expeditionBatch = await batchService.findById(
        batchInvoice.expedition_batch_id,
        { transaction: t },
      );

      if (!expeditionBatch) {
        throw new Error(`Lote não encontrado!`);
      }

      if (["FINISHED", "CANCELLED"].includes(expeditionBatch.status)) {
        throw new Error(
          `Não é possível remover notas fiscais de lotes finalizados ou cancelados.`,
        );
      }

      // Busca os batchInvoiceItems para decrementar via dados já consolidados
      const batchInvoiceItems = await batchInvoiceItemsService.findAll({
        where: { expedition_batch_invoice_id: batchInvoice.id },
        transaction: t,
      });

      if (!batchInvoiceItems.length) {
        throw new Error(`Nota fiscal não possui itens no lote`);
      }

      // Decrementa batchItems e batch em paralelo por item
      await Promise.all(
        batchInvoiceItems.map(async (bii) => {
          await batchItemsService.decrement("quantity", {
            by: bii.quantity_expected,
            where: { id: bii.expedition_batch_item_id },
            transaction: t,
          });

          await batchItemsService.decrement("quantity_scanned", {
            by: bii.quantity_read,
            where: { id: bii.expedition_batch_item_id },
            transaction: t,
          });

          await batchService.decrement("total_volumes", {
            by: bii.quantity_expected,
            where: { id: batchInvoice.expedition_batch_id },
            transaction: t,
          });

          await batchService.decrement("total_volumes_received", {
            by: bii.quantity_read,
            where: { id: batchInvoice.expedition_batch_id },
            transaction: t,
          });
        }),
      );

      // Remove batchItems zerados
      await batchItemsService.bulkDelete({
        where: {
          expedition_batch_id: batchInvoice.expedition_batch_id,
          quantity: { [Op.lte]: 0 },
        },
        transaction: t,
      });

      // Remove batchInvoiceItems
      await batchInvoiceItemsService.bulkDelete({
        where: { expedition_batch_invoice_id: batchInvoice.id },
        transaction: t,
      });

      // Reseta status da invoice via attributes (batch_generated e status vivem lá)
      await invoiceService.updateInvoices(
        [batchInvoice.invoice_id],
        expeditionBatch.unit_business_id,
        { batch_generated: false, status: "PENDING" },
      );

      await scanLogsService.bulkDelete({
        where: {
          expedition_batch_id: batchInvoice.expedition_batch_id,
          expedition_batch_invoices_id: batchInvoice.id,
        },
        transaction: t,
      });

      await this.delete(batchInvoice.id, { transaction: t });
    };

    if (externalTransaction) {
      return run(externalTransaction);
    } else {
      return sequelize.transaction(run);
    }
  }

  async createBatchInvoiceWithItems(
    batchId: string,
    invoices: Array<Invoice & { items?: InvoiceItemsAttributes[] }>,
    t: Transaction,
  ): Promise<{
    batchInvoices: ExpeditionBatchInvoice[];
    volumesAdded: number;
  }> {
    // ── 1. Criar todas as BatchInvoices de uma vez ────────────────────────
    const batchInvoices = await this.bulkCreate(
      invoices.map((invoice) => ({
        expedition_batch_id: batchId,
        invoice_id: invoice.id,
      })),
      { transaction: t, returning: true },
    );

    // Mapa invoice_id → batchInvoice criada
    const batchInvoiceByInvoiceId = new Map(
      batchInvoices.map((bi, i) => [invoices[i].id, bi]),
    );

    // ── 2. Flatten de todos os items com referência à sua batchInvoice ────
    const allItems = invoices.flatMap((invoice) =>
      (invoice.items ?? []).map((item) => ({
        ...item,
        batchInvoice: batchInvoiceByInvoiceId.get(invoice.id)!,
      })),
    );

    if (allItems.length === 0) {
      return { batchInvoices, volumesAdded: 0 };
    }

    const allProductIds = [...new Set(allItems.map((i) => i.product_id))];

    // ── 3. Buscar batchItems existentes num único findAll ─────────────────
    const existingBatchItems = await batchItemsService.findAll({
      where: {
        expedition_batch_id: batchId,
        product_id: { [Op.in]: allProductIds },
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    // Map product_id → batchItem existente
    const batchItemByProductId = new Map(
      existingBatchItems.map((bi) => [bi.product_id, bi]),
    );

    // ── 4. Separar batchItems em criar vs incrementar ─────────────────────
    // Acumula quantity por product_id antes de qualquer escrita
    const quantityToAddByProductId = new Map<string, number>();
    for (const item of allItems) {
      const current = quantityToAddByProductId.get(item.product_id) ?? 0;
      quantityToAddByProductId.set(
        item.product_id,
        current + item.quantity_expected,
      );
    }

    const productIdsToCreate = allProductIds.filter(
      (id) => !batchItemByProductId.has(id),
    );
    const productIdsToIncrement = allProductIds.filter((id) =>
      batchItemByProductId.has(id),
    );

    // Criar novos batchItems em bulk
    const createdBatchItems =
      productIdsToCreate.length > 0
        ? await batchItemsService.bulkCreate(
            productIdsToCreate.map((productId) => ({
              expedition_batch_id: batchId,
              product_id: productId,
              quantity: quantityToAddByProductId.get(productId)!,
              quantity_scanned: 0,
            })),
            { transaction: t, returning: true },
          )
        : [];

    // Incrementar batchItems existentes — um bulkUpdate por product_id seria
    // ideal, mas como increment não aceita lista, fazemos updates em paralelo
    // (sem loop serial — Promise.all emite tudo de uma vez para o banco)
    await Promise.all(
      productIdsToIncrement.map((productId) =>
        batchItemsService.increment("quantity", {
          by: quantityToAddByProductId.get(productId)!,
          where: {
            expedition_batch_id: batchId,
            product_id: productId,
          },
          transaction: t,
        }),
      ),
    );

    // Mapa product_id → batchItem final (existentes + criados)
    const finalBatchItemByProductId = new Map([
      ...batchItemByProductId,
      ...createdBatchItems.map((bi) => [bi.product_id, bi] as const),
    ]);

    // ── 5. Buscar batchInvoiceItems existentes num único findAll ──────────
    const allBatchItemIds = [...finalBatchItemByProductId.values()].map(
      (bi) => bi.id,
    );
    const allBatchInvoiceIds = batchInvoices.map((bi) => bi.id);

    const existingBatchInvoiceItems = await batchInvoiceItemsService.findAll({
      where: {
        expedition_batch_item_id: { [Op.in]: allBatchItemIds },
        expedition_batch_invoice_id: { [Op.in]: allBatchInvoiceIds },
      },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    // Map "batchInvoiceId:batchItemId" → batchInvoiceItem existente
    const batchInvoiceItemKey = (invoiceId: string, itemId: string) =>
      `${invoiceId}:${itemId}`;

    const existingBatchInvoiceItemMap = new Map(
      existingBatchInvoiceItems.map((bii) => [
        batchInvoiceItemKey(
          bii.expedition_batch_invoice_id,
          bii.expedition_batch_item_id,
        ),
        bii,
      ]),
    );

    // ── 6. Acumular quantity_expected por (batchInvoiceId, batchItemId) ───
    const quantityByKey = new Map<
      string,
      { batchItemId: string; batchInvoiceId: string; quantity: number }
    >();

    let volumesAdded = 0;

    for (const item of allItems) {
      const batchItem = finalBatchItemByProductId.get(item.product_id)!;
      const batchInvoiceId = item.batchInvoice.id;
      const key = batchInvoiceItemKey(batchInvoiceId, batchItem.id);

      const current = quantityByKey.get(key) ?? {
        batchItemId: batchItem.id,
        batchInvoiceId,
        quantity: 0,
      };
      current.quantity += item.quantity_expected;
      quantityByKey.set(key, current);
      volumesAdded += item.quantity_expected;
    }

    // ── 7. Separar batchInvoiceItems em criar vs incrementar ─────────────
    const toCreateBatchInvoiceItems: BatchInvoiceItemsCreationAttributes[] = [];

    const toIncrementBatchInvoiceItems: Array<{
      id: string;
      quantity: number;
    }> = [];

    for (const [
      key,
      { batchItemId, batchInvoiceId, quantity },
    ] of quantityByKey) {
      const existing = existingBatchInvoiceItemMap.get(key);
      if (existing) {
        toIncrementBatchInvoiceItems.push({ id: existing.id, quantity });
      } else {
        toCreateBatchInvoiceItems.push({
          expedition_batch_item_id: batchItemId,
          expedition_batch_invoice_id: batchInvoiceId,
          quantity_expected: quantity,
          quantity_read: 0,
          status: "PENDING",
        });
      }
    }

    await Promise.all([
      toCreateBatchInvoiceItems.length > 0
        ? batchInvoiceItemsService.bulkCreate(toCreateBatchInvoiceItems, {
            transaction: t,
          })
        : Promise.resolve(),

      ...toIncrementBatchInvoiceItems.map(({ id, quantity }) =>
        batchInvoiceItemsService.increment("quantity_expected", {
          by: quantity,
          where: { id },
          transaction: t,
        }),
      ),
    ]);

    return { batchInvoices, volumesAdded };
  }

  
}
export default new ExpeditionBatchInvoiceService();
