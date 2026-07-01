import { Op, Sequelize, Transaction } from "sequelize";
import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { Product } from "../../../inventory";
import Invoice from "../../invoices/invoice/invoice.model";
import invoiceService from "../../invoices/invoice/invoice.service";
import ExpeditionBatchInvoice from "../batch-invoices/batch-invoices.model";
import ExpeditionBatchItems from "../batch-items/batch-items.model";
import batchItemsService, {
  ExpeditionBatchItemsService,
} from "../batch-items/batch-items.service";
import { ExpeditionBaatchItemFull } from "../batch-items/batch-items.types";
import ExpeditionBatch from "../batch/batch.model";
import { ExpeditionBatchFull } from "../batch/batch.types";
import BatchInvoiceItems from "../batch-invoice-items/batch-invoice-items.model";
import ExpeditionScanLog from "./scan-logs.model";
import expeditionScanLogRepository, {
  ExpeditionScanLogRepository,
} from "./scan-logs.repository";
import supplierMappingService from "../../../inventory/supplier-mapping/supplier-mapping.service";
import productsService from "../../../inventory/products/product.service";
import InvoiceItems from "../../invoices/invoice-items/invoice-items.model";
import batchInvoiceItemsService from "../batch-invoice-items/batch-invoice-items.service";
import batchService from "../batch/batch.service";
import batchInvoicesService from "../batch-invoices/batch-invoices.service";
import { assertTransshipment } from "../utils/helpers/transshipment-resolver";
import InvoiceUnitBusinessAttributes from "../../invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";

export class ExpeditionScanLogService extends BaseService<
  ExpeditionScanLog,
  ExpeditionScanLogRepository
> {
  private batchItemService: ExpeditionBatchItemsService;

  constructor() {
    super(expeditionScanLogRepository);
    this.batchItemService = batchItemsService;

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "created_at",
        sortDir: "DESC",
      },
      searchFields: ["label_full_code"],
      filterableFields: [
        "expedition_batch_id",
        "expedition_batch_items_id",
        "expedition_batch_invoices_id",
        "user_id",
      ],
      sortableFields: ["vol_number"],
    };
  }

  /**
   * Busca produto por EAN/EAN tribut ou por supplier_product_code.
   * Centraliza a lógica de resolução de produto por código em todas as funções.
   */
  private async findProductByCode(
    code: string,
    t?: Transaction,
  ): Promise<{ product: Product; matchedCode: string }> {
    const result = await productsService.findByCode(code, {
      transaction: t,
    });

    if (!result) throw new Error("Produto não encontrado!");

    return result;
  }

  /**
   * Função centralizada que sincroniza todos os contadores e status
   * após criação ou remoção de scan logs.
   *
   * @param batchId        - ID do lote pai
   * @param batchItemId    - ID do ExpeditionBatchItem (produto no lote)
   * @param batchInvoiceId - ID do ExpeditionBatchInvoice (NF no lote)
   * @param delta          - quantidade a incrementar (positivo) ou decrementar (negativo)
   * @param t              - transação ativa
   */
  private async syncFromScanning(
    batchId: string,
    batchItemId: string,
    batchInvoiceId: string,
    delta: number,
    t: Transaction,
  ): Promise<void> {
    // ── 1. Resolve unit_business_id do lote pai ────────────────────────────
    const batch = await batchService.findById(batchId, {
      attributes: ["id", "unit_business_id"],
      transaction: t,
      lock: t.LOCK.UPDATE,
    });

    if (!batch) throw new Error("Lote não encontrado");
    const unitBusinessId: string = (batch as any).unit_business_id;

    // ── 2. Atualiza BatchInvoiceItems.quantity_read ────────────────────────
    if (delta > 0) {
      await batchInvoiceItemsService.increment("quantity_read", {
        by: delta,
        where: {
          expedition_batch_invoice_id: batchInvoiceId,
          expedition_batch_item_id: batchItemId,
        },
        transaction: t,
      });
    } else {
      await batchInvoiceItemsService.decrement("quantity_read", {
        by: Math.abs(delta),
        where: {
          expedition_batch_invoice_id: batchInvoiceId,
          expedition_batch_item_id: batchItemId,
        },
        transaction: t,
      });
    }

    // ── 3. Atualiza ExpeditionBatchItems.quantity_scanned ──────────────────
    if (delta > 0) {
      await batchItemsService.increment("quantity_scanned", {
        by: delta,
        where: { id: batchItemId },
        transaction: t,
      });
    } else {
      await batchItemsService.decrement("quantity_scanned", {
        by: Math.abs(delta),
        where: { id: batchItemId },
        transaction: t,
      });
    }

    // ── 4. Atualiza ExpeditionBatch.total_volumes_received ─────────────────
    if (delta > 0) {
      await batchService.increment("total_volumes_received", {
        by: delta,
        where: { id: batchId },
        transaction: t,
      });
    } else {
      await batchService.decrement("total_volumes_received", {
        by: Math.abs(delta),
        where: { id: batchId },
        transaction: t,
      });
    }

    // ── 5. Reavalia status da NF via InvoiceUnitBusinessAttributes ─────────

    const pendingBatchInvoiceItem = await batchInvoiceItemsService.findOne({
      where: {
        expedition_batch_invoice_id: batchInvoiceId,
        quantity_read: { [Op.lt]: sequelize.col("quantity_expected") },
      },
      transaction: t,
    });

    if (pendingBatchInvoiceItem) {
      const bi = await batchInvoicesService.findById(batchInvoiceId, {
        attributes: ["invoice_id"],
        transaction: t,
      });

      if (bi) {
        const invoiceId: string = (bi as any).invoice_id;
        await invoiceService.updateInvoices([invoiceId], unitBusinessId, {
          status: "PENDING",
        });
      }
    }
  }

  async scanProduct(
    labelcode: string,
    productcode: string,
    batchid: string,
    userId: string,
    unitBusiness: { cnpj: string; transshipment_allowed?: boolean } | null,
  ) {
    return await sequelize.transaction(async (t) => {
      if (labelcode.length < 41) {
        throw Error("Etiqueta inválida");
      }

      const nffromlabel = labelcode.substring(14, 22);
      const labelRead = labelcode;
      const volRead = labelcode.substring(35, 41);

      const alreadyExists = await this.findOne({
        where: { label_full_code: labelRead },
        transaction: t,
      });

      if (alreadyExists)
        throw Error(
          `Volume ${volRead} já lido no lote para nota ${nffromlabel}`,
        );

      const invoiceRead = (await ExpeditionBatch.findOne({
        where: { id: batchid },
        include: [
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoices",
            include: [
              {
                model: Invoice,
                as: "invoice",
                attributes: { exclude: ["xml_path"] },
                where: {
                  number_system: {
                    [Op.iLike]: `%${nffromlabel.replace(/^0+/, "")}`,
                  },
                },
              },
            ],
          },
        ],
        transaction: t,
      })) as ExpeditionBatchFull;

      if (!invoiceRead || !invoiceRead.batchInvoices?.length) {
        throw new Error("Nota não encontrada no lote");
      }

      const batchInvoice = invoiceRead.batchInvoices[0];

      if (!batchInvoice.invoice) {
        throw new Error("Nota fiscal não carregada corretamente");
      }

      await assertTransshipment(batchInvoice.invoice, unitBusiness);

      // ── Busca produto centralizada (EAN + supplier mapping) ───────────────
      const { product, matchedCode } = await this.findProductByCode(
        productcode,
        t,
      );

      const productRead = await batchItemsService.findOne({
        where: {
          expedition_batch_id: batchid,
          product_id: product.id,
        },
        transaction: t,
      });

      if (!productRead) throw Error("Produto não encontrado no lote");

      const productReadLocked = (await batchItemsService.findOne({
        where: { id: productRead.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      })) as ExpeditionBaatchItemFull;

      productReadLocked.product = product;

      if (productReadLocked.quantity_scanned >= productReadLocked.quantity) {
        throw Error("Produto já totalmente bipado");
      }

      const stripLeadingZeros = (v: string) => v.replace(/^0+/, "");

      const eanExistsOnLabel =
        product.ean &&
        (labelcode.includes(product.ean) ||
          labelcode.includes(stripLeadingZeros(product.ean)));

      const eanTributExistsOnLabel =
        product.ean_tribut &&
        (labelcode.includes(product.ean_tribut) ||
          labelcode.includes(stripLeadingZeros(product.ean_tribut)));

      const matchedCodeExistsOnLabel =
        matchedCode &&
        (labelcode.includes(matchedCode) ||
          labelcode.includes(stripLeadingZeros(matchedCode)));

      if (
        !eanExistsOnLabel &&
        !eanTributExistsOnLabel &&
        !matchedCodeExistsOnLabel
      ) {
        throw Error("Etiqueta não pertencente ao produto lido!");
      }

      try {
        await this.create(
          {
            expedition_batch_items_id: productRead.id,
            expedition_batch_invoices_id: batchInvoice.id,
            expedition_batch_id: batchid,
            label_full_code: labelRead,
            vol_number: volRead,
            user_id: userId,
          },
          { transaction: t },
        );
      } catch (error: any) {
        if (error.name === "SequelizeUniqueConstraintError") {
          throw new Error(`Volume ${volRead} já lido`);
        }
        throw error;
      }

      await this.syncFromScanning(
        batchid,
        productRead.id,
        batchInvoice.id,
        1,
        t,
      );
    });
  }

  async scanProductIncoming(
    labelcode: string,
    batchid: string,
    userId: string,
    quantity: number = 1,
    unitBusiness: { cnpj: string; transshipment_allowed?: boolean } | null,
  ) {
    return await sequelize.transaction(async (t) => {
      // ── 1. Valida e bloqueia o lote ────────────────────────────────────────
      const batch = await batchService.findById(batchid, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) throw new Error("Lote não encontrado");
      if (batch.type !== "INCOMING") throw new Error("Lote não é de entrada");
      if (batch.status === "FINISHED") throw new Error("Lote já finalizado");

      // ── 2. Busca produto centralizada (EAN + supplier mapping) ─────────────
      const {product} = await this.findProductByCode(labelcode, t);

      // ── 3. Busca o BatchItem do produto neste lote (com lock) ──────────────
      const batchItem = await batchItemsService.findOne({
        where: {
          expedition_batch_id: batchid,
          product_id: product.id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batchItem) {
        throw new Error(
          `Produto não encontrado nos itens do lote. ` +
            `Verifique se a nota fiscal de entrada contém este produto.`,
        );
      }

      // ── 4. Busca batchInvoices que contêm este produto, ordenadas por createdAt
      const batchInvoices = (await ExpeditionBatchInvoice.findAll({
        where: { expedition_batch_id: batchid },
        include: [
          {
            model: Invoice,
            as: "invoice",
            required: true,
            include: [
              {
                model: InvoiceUnitBusinessAttributes,
                as: "unitBusinessAttributes",
                where: { type: "INCOMING", unit_business_id: batch.unit_business_id },
                required: true,
              },
            ],
          },
          {
            model: BatchInvoiceItems,
            as: "items",
            where: { expedition_batch_item_id: batchItem.id },
            required: true,
          },
        ],
        order: [["createdAt", "ASC"]],
        transaction: t,
      })) as any[];

      if (!batchInvoices.length) {
        throw new Error(
          "Nenhuma nota fiscal encontrada para este produto no lote",
        );
      }

      await assertTransshipment(batchInvoices[0].invoice, unitBusiness);

      let remaining = quantity;
      const scanLogs: any[] = [];
      const syncMap = new Map<string, number>();

      for (const bi of batchInvoices) {
        if (remaining <= 0) break;

        const batchInvoiceItem = bi.items[0];

        const fresh = await batchInvoiceItemsService.findById(
          batchInvoiceItem.id,
          { transaction: t, lock: t.LOCK.UPDATE },
        );

        if (!fresh) continue;

        const space =
          Number(fresh.quantity_expected) - Number(fresh.quantity_read);
        if (space <= 0) continue;

        const toIncrement = Math.min(remaining, space);

        for (let j = 0; j < toIncrement; j++) {
          scanLogs.push({
            expedition_batch_id: batchid,
            expedition_batch_items_id: batchItem.id,
            expedition_batch_invoices_id: bi.id,
            label_full_code: labelcode,
            vol_number: "000000",
            user_id: userId,
          });
        }

        syncMap.set(bi.id, (syncMap.get(bi.id) ?? 0) + toIncrement);
        remaining -= toIncrement;
      }

      // Over-receiving: joga o restante na última NF
      if (remaining > 0) {
        const lastBi = batchInvoices[batchInvoices.length - 1];

        for (let j = 0; j < remaining; j++) {
          scanLogs.push({
            expedition_batch_id: batchid,
            expedition_batch_items_id: batchItem.id,
            expedition_batch_invoices_id: lastBi.id,
            label_full_code: labelcode,
            vol_number: "000000",
            user_id: userId,
          });
        }

        syncMap.set(lastBi.id, (syncMap.get(lastBi.id) ?? 0) + remaining);
      }

      // ── 5. Cria todos os ScanLogs ──────────────────────────────────────────
      await this.bulkCreate(scanLogs, { transaction: t });

      // ── 6. Sincroniza contadores e status por batchInvoice ─────────────────
      for (const [biId, delta] of syncMap.entries()) {
        await this.syncFromScanning(batchid, batchItem.id, biId, delta, t);
      }

      return true;
    });
  }

  async scanProductIncomingByInvoice(
    labelcode: string,
    batchid: string,
    invoiceId: string,
    userId: string,
    quantity: number = 1,
    unitBusiness: { cnpj: string; transshipment_allowed?: boolean } | null,
  ) {
    return await sequelize.transaction(async (t) => {
      // ── 1. Valida e bloqueia o lote ────────────────────────────────────────
      const batch = await batchService.findById(batchid, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) throw new Error("Lote não encontrado");
      if (batch.type !== "INCOMING") throw new Error("Lote não é de entrada");
      if (batch.status === "FINISHED") throw new Error("Lote já finalizado");

      // ── 2. Busca produto centralizada (EAN + supplier mapping) ─────────────
      const {product} = await this.findProductByCode(labelcode, t);

      // ── 3. Busca o BatchItem do produto neste lote (com lock) ──────────────
      const batchItem = await batchItemsService.findOne({
        where: {
          expedition_batch_id: batchid,
          product_id: product.id,
        },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batchItem) {
        throw new Error(
          `Produto não encontrado nos itens do lote. ` +
            `Verifique se a nota fiscal de entrada contém este produto.`,
        );
      }

      // ── 4. Busca a batchInvoice vinculada ao invoiceId informado ───────────
      const batchInvoice = (await ExpeditionBatchInvoice.findOne({
        where: { expedition_batch_id: batchid },
        include: [
          {
            model: Invoice,
            as: "invoice",
            where: { id: invoiceId },
            required: true,
            include: [
              {
                model: InvoiceUnitBusinessAttributes,
                as: "unitBusinessAttributes",
                where: { type: "INCOMING", unit_business_id: batch.unit_business_id },
                required: true,
              },
            ],
          },
          {
            model: BatchInvoiceItems,
            as: "items",
            where: { expedition_batch_item_id: batchItem.id },
            required: true,
          },
        ],
        transaction: t,
      })) as any;

      if (!batchInvoice) {
        throw new Error(
          "Nota fiscal não encontrada no lote ou não contém este produto",
        );
      }

      await assertTransshipment(batchInvoice.invoice, unitBusiness);

      // ── 5. Cria os ScanLogs ────────────────────────────────────────────────
      const scanLogs = Array.from({ length: quantity }, () => ({
        expedition_batch_id: batchid,
        expedition_batch_items_id: batchItem.id,
        expedition_batch_invoices_id: batchInvoice.id,
        label_full_code: labelcode,
        vol_number: "000000",
        user_id: userId,
      }));

      await this.bulkCreate(scanLogs, { transaction: t });

      // ── 6. Sincroniza contadores e status ──────────────────────────────────
      await this.syncFromScanning(
        batchid,
        batchItem.id,
        batchInvoice.id,
        quantity,
        t,
      );

      return true;
    });
  }

  async bulkRemoveScanLogsOutgoing(
    batchid: string,
    items: Array<{
      labelcode: string;
      productcode: string;
      quantity: number;
      batchInvoiceId?: string;
    }>,
  ) {
    return await sequelize.transaction(async (t) => {
      const batch = await batchService.findById(batchid, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) throw new Error("Lote não encontrado");
      if (batch.type === "INCOMING") throw new Error("Lote não é de saída");

      for (const item of items) {
        // ── Busca produto centralizada (EAN + supplier mapping) ───────────────
        const {product} = await this.findProductByCode(item.productcode, t);

        const productRead = (await batchItemsService.findOne({
          where: {
            expedition_batch_id: batchid,
            product_id: product.id,
          },
          transaction: t,
        })) as ExpeditionBaatchItemFull;

        if (!productRead)
          throw new Error(
            `Produto não encontrado no lote: ${item.productcode}`,
          );

        const batchItemLocked = (await batchItemsService.findOne({
          where: { id: productRead.id },
          transaction: t,
          lock: t.LOCK.UPDATE,
        })) as ExpeditionBaatchItemFull;

        if (batchItemLocked.quantity_scanned < item.quantity) {
          throw new Error(
            `Quantidade a remover (${item.quantity}) maior que volumes já bipados (${batchItemLocked.quantity_scanned}) para ${item.productcode}`,
          );
        }

        const logsToDelete = await this.findAll({
          where: {
            expedition_batch_id: batchid,
            expedition_batch_items_id: productRead.id,
            ...(item.batchInvoiceId
              ? { expedition_batch_invoices_id: item.batchInvoiceId }
              : {}),
          },
          attributes: ["id", "vol_number", "expedition_batch_invoices_id"],
          order: [["vol_number", "DESC"]],
          limit: item.quantity,
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (logsToDelete.length < item.quantity) {
          throw new Error(
            `Registros encontrados (${logsToDelete.length}) insuficientes para remover ${item.quantity} volume(s) de ${item.productcode}`,
          );
        }

        await this.bulkDelete({
          where: { id: logsToDelete.map((l) => l.id) },
          transaction: t,
        });

        const affectedMap = new Map<string, number>();
        for (const log of logsToDelete) {
          const biId: string = (log as any).expedition_batch_invoices_id;
          affectedMap.set(biId, (affectedMap.get(biId) ?? 0) + 1);
        }

        for (const [biId, count] of affectedMap.entries()) {
          await this.syncFromScanning(batchid, productRead.id, biId, -count, t);
        }
      }

      return true;
    });
  }

  async bulkRemoveScanLogsIncoming(
    batchid: string,
    items: Array<{
      productId: string;
      quantity: number;
      batchInvoiceId?: string;
    }>,
  ) {
    return await sequelize.transaction(async (t) => {
      const batch = await batchService.findById(batchid, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) throw new Error("Lote não encontrado");
      if (batch.type !== "INCOMING") throw new Error("Lote não é de entrada");

      for (const item of items) {
        const batchItem = await batchItemsService.findOne({
          where: {
            expedition_batch_id: batchid,
            product_id: item.productId,
          },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (!batchItem)
          throw new Error(
            `BatchItem não encontrado para produto ${item.productId}`,
          );

        if (batchItem.quantity_scanned < item.quantity) {
          throw new Error(
            `Quantidade a remover (${item.quantity}) maior que volumes já bipados (${batchItem.quantity_scanned})`,
          );
        }

        const logsToDelete = await this.findAll({
          where: {
            expedition_batch_id: batchid,
            expedition_batch_items_id: batchItem.id,
            ...(item.batchInvoiceId
              ? { expedition_batch_invoices_id: item.batchInvoiceId }
              : {}),
          },
          order: [["createdAt", "DESC"]],
          limit: item.quantity,
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (logsToDelete.length < item.quantity) {
          throw new Error(
            `Registros encontrados (${logsToDelete.length}) insuficientes para remover ${item.quantity} volume(s)`,
          );
        }

        await this.bulkDelete({
          where: { id: logsToDelete.map((l) => l.id) },
          transaction: t,
        });

        const affectedMap = new Map<string, number>();
        for (const log of logsToDelete) {
          const biId: string = (log as any).expedition_batch_invoices_id;
          affectedMap.set(biId, (affectedMap.get(biId) ?? 0) + 1);
        }

        for (const [biId, count] of affectedMap.entries()) {
          await this.syncFromScanning(batchid, batchItem.id, biId, -count, t);
        }
      }

      return true;
    });
  }
}

export default new ExpeditionScanLogService();
