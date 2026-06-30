import { Op, Sequelize, Transaction } from "sequelize";
import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { Product, SupplierMapping } from "../../../inventory";
import Invoice from "../../entrance/invoice/invoice.model";
import ExpeditionBatchInvoice from "../batch-invoices/batch-invoices.model";
import ExpeditionBatchItems from "../batch-items/batch-items.model";
import batchItemsService, {
  ExpeditionBatchItemsService,
} from "../batch-items/batch-items.service";
import { ExpeditionBaatchItemFull } from "../batch-items/batch-items.types";
import ExpeditionBatch from "../batch/batch.model";
import { ExpeditionBatchFull } from "../batch/batch.types";
import ExpeditionScanLog from "./scan-logs.model";
import expeditionScanLogRepository, {
  ExpeditionScanLogRepository,
} from "./scan-logs.repository";
import InvoiceItems from "../../entrance/invoice-items/invoice-items.model";
import supplierMappingService from "../../../inventory/supplier-mapping/supplier-mapping.service";

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

  private assertTransshipment(
    invoice: { sender_cnpj: string | null; receiver_cnpj: string | null },
    unitBusiness: { cnpj: string; transshipment_allowed?: boolean } | null,
  ): void {
    if (!unitBusiness || unitBusiness.transshipment_allowed) return;

    const normalize = (cnpj: string | null) => (cnpj ?? "").replace(/\D/g, "");
    const unitCnpj = normalize(unitBusiness.cnpj);

    const allowed =
      normalize(invoice.sender_cnpj) === unitCnpj ||
      normalize(invoice.receiver_cnpj) === unitCnpj;

    if (!allowed) {
      throw new Error(
        "Leitura bloqueada: nota fiscal não pertence à sua unidade de negócio",
      );
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
      const eanfromlabel = labelcode.substring(22, 35);
      const labelRead = labelcode;
      const volRead = labelcode.substring(35, 41);

      const alreadyExists = await ExpeditionScanLog.findOne({
        where: {
          label_full_code: labelRead,
        },
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

      console.log(invoiceRead, productcode, eanfromlabel);

      if (!invoiceRead || !invoiceRead.batchInvoices?.length) {
        throw new Error("Nota não encontrada no lote");
      }

      const batchInvoice = invoiceRead.batchInvoices[0];

      if (!batchInvoice.invoice) {
        throw new Error("Nota fiscal não carregada corretamente");
      }

      this.assertTransshipment(batchInvoice.invoice, unitBusiness);

      // ── Busca o produto primeiro (raiz correta, sem include aninhado) ──
      let matchedSupplierCode: string | null = null;

      let product = await Product.findOne({
        where: {
          [Op.or]: [{ ean: productcode }, { ean_tribut: productcode }],
        },
        transaction: t,
      });

      if (!product) {
        const supplierMapping = await SupplierMapping.findOne({
          where: { supplier_product_code: productcode },
          include: [
            {
              model: Product,
              as: "product",
            },
          ],
          transaction: t,
        });

        if (supplierMapping?.product) {
          product = supplierMapping.product;
          matchedSupplierCode = supplierMapping.supplier_product_code;
        }
      }

      if (!product) throw Error("Produto não encontrado");

      // ── Busca o item do lote vinculado a esse produto ───────────────────
      let productRead = await ExpeditionBatchItems.findOne({
        where: {
          expedition_batch_id: batchid,
          product_id: product.id,
        },
        transaction: t,
      });

      if (!productRead) throw Error("Produto não encontrado no lote");

      const productReadLocked = (await ExpeditionBatchItems.findOne({
        where: { id: productRead.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      })) as ExpeditionBaatchItemFull;

      productReadLocked.product = product;

      if (productReadLocked.quantity_scanned >= productReadLocked.quantity) {
        throw Error("Produto já totalmente bipado");
      }

      const eanExistsOnLabel = product.ean && labelcode.includes(product.ean);
      const eanTributExistsOnLabel =
        product.ean_tribut && labelcode.includes(product.ean_tribut);
      const supplierCodeExistsOnLabel =
        matchedSupplierCode && labelcode.includes(matchedSupplierCode);

      if (
        !eanExistsOnLabel &&
        !eanTributExistsOnLabel &&
        !supplierCodeExistsOnLabel
      ) {
        throw Error("Etiqueta não pertencente ao produto lido!");
      }
      try {
        await ExpeditionScanLog.create(
          {
            expedition_batch_items_id: productRead.id,
            expedition_batch_invoices_id: invoiceRead?.batchInvoices?.[0].id,
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

      await this.batchItemService.updateBatchItemAndBatch(
        productRead.id,
        invoiceRead?.batchInvoices?.[0]?.invoice?.id!,
        productRead.product_id,
        t,
      );

      const invoiceId = invoiceRead?.batchInvoices?.[0]?.invoice?.id!;

      const invoiceItem = await InvoiceItems.findOne({
        where: { invoice_id: invoiceId },
        attributes: ["quantity_expected", "quantity_received"],
        transaction: t,
      });

      const pendingItem = await InvoiceItems.findOne({
        where: {
          invoice_id: invoiceId,
          [Op.and]: sequelize.literal(
            '"quantity_received" < "quantity_expected"',
          ),
        },
        transaction: t,
      });

      if (!pendingItem) {
        await Invoice.update(
          { status: "FINISHED" },
          { where: { id: invoiceId }, transaction: t },
        );
      }

      const pendingInvoices = await Invoice.count({
        include: [
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoice",
            where: { expedition_batch_id: batchid },
            required: true,
          },
        ],
        where: { status: { [Op.ne]: "FINISHED" } },
        transaction: t,
      });

      if (pendingInvoices === 0) {
        await ExpeditionBatch.update(
          { status: "FINISHED" },
          { where: { id: batchid }, transaction: t },
        );
      }
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
      const batch = await ExpeditionBatch.findByPk(batchid, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) throw new Error("Lote não encontrado");
      if (batch.type !== "INCOMING") throw new Error("Lote não é de entrada");
      if (batch.status === "FINISHED") throw new Error("Lote já finalizado");

      // ── 2. Busca o produto pelo EAN ────────────────────────────────────────
      let productFound = await Product.findOne({
        where: {
          [Op.or]: [{ ean: labelcode }, { ean_tribut: labelcode }],
        },
      });

      if (!productFound) {
        const supplierMapping =
          await supplierMappingService.findByProductCode(labelcode);

        productFound = supplierMapping?.product ?? null;
      }

      if (!productFound) throw new Error("Produto não encontrado!");

      // ── 3. Busca o BatchItem do produto neste lote (com lock) ──────────────
      const batchItem = await ExpeditionBatchItems.findOne({
        where: {
          expedition_batch_id: batchid,
          product_id: productFound.id,
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

      // ── 5. Resolve qual InvoiceItem incrementar (preenche uma NF por vez) ──
      //    Busca todas as batchInvoices do lote que contêm este produto,
      //    ordenadas por createdAt para garantir ordem consistente,
      //    e pega a primeira que ainda tem quantity_received < quantity_expected
      const batchInvoices = (await ExpeditionBatchInvoice.findAll({
        where: { expedition_batch_id: batchid },
        include: [
          {
            model: Invoice,
            as: "invoice",
            where: { type: "INCOMING" },
            include: [
              {
                model: InvoiceItems,
                as: "items",
                where: { product_id: productFound.id },
                required: true,
              },
            ],
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

      this.assertTransshipment(batchInvoices[0].invoice, unitBusiness);

      let remaining = quantity;
      const scanLogs: any[] = [];

      for (const batchInvoice of batchInvoices) {
        if (remaining <= 0) break;

        const invoiceItem = batchInvoice.invoice.items[0];
        const invoiceId = batchInvoice.invoice.id;

        // Lê o valor atual direto do banco com lock
        const fresh = await InvoiceItems.findByPk(invoiceItem.id, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (!fresh) continue;

        const space = fresh.quantity_expected - fresh.quantity_received;
        if (space <= 0) continue; // NF já cheia, vai pra próxima

        const toIncrement = Math.min(remaining, space);

        await InvoiceItems.increment("quantity_received", {
          by: toIncrement,
          where: { id: fresh.id },
          transaction: t,
        });

        for (let j = 0; j < toIncrement; j++) {
          scanLogs.push({
            expedition_batch_id: batchid,
            expedition_batch_items_id: batchItem.id,
            expedition_batch_invoices_id: batchInvoice.id,
            label_full_code: labelcode,
            vol_number: "000000",
            user_id: userId,
          });
        }

        remaining -= toIncrement;

        // Checa se esta NF fechou
        const stillPending = await InvoiceItems.count({
          where: {
            invoice_id: invoiceId,
            quantity_received: { [Op.lt]: sequelize.col("quantity_expected") },
          },
          transaction: t,
        });

        if (stillPending === 0) {
          await Invoice.update(
            { status: "FINISHED" },
            { where: { id: invoiceId }, transaction: t },
          );
        }
      }

      // Over-receiving: se sobrou, joga na última NF
      if (remaining > 0) {
        const lastInvoice = batchInvoices[batchInvoices.length - 1];
        const lastItem = lastInvoice.invoice.items[0];

        await InvoiceItems.increment("quantity_received", {
          by: remaining,
          where: { id: lastItem.id },
          transaction: t,
        });

        for (let j = 0; j < remaining; j++) {
          scanLogs.push({
            expedition_batch_id: batchid,
            expedition_batch_items_id: batchItem.id,
            expedition_batch_invoices_id: lastInvoice.id,
            label_full_code: labelcode,
            vol_number: "000000",
            user_id: userId,
          });
        }
      }

      // ── 6. Cria todos os ScanLogs de uma vez ──────────────────────────────
      await ExpeditionScanLog.bulkCreate(scanLogs, { transaction: t });

      // ── 7. Incrementa BatchItem e total do lote ────────────────────────────
      await ExpeditionBatchItems.increment("quantity_scanned", {
        by: quantity,
        where: { id: batchItem.id },
        transaction: t,
      });

      await ExpeditionBatch.increment("total_volumes_received", {
        by: quantity,
        where: { id: batchid },
        transaction: t,
      });

      // ── 8. Verifica se todas as NFs do lote foram finalizadas ──────────────
      const pendingInvoices = await Invoice.count({
        include: [
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoice",
            where: { expedition_batch_id: batchid },
            required: true,
          },
        ],
        where: { status: { [Op.ne]: "FINISHED" } },
        transaction: t,
      });

      if (pendingInvoices === 0) {
        // TODO: gerar NF-e na Bling
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
      const batch = await ExpeditionBatch.findByPk(batchid, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) throw new Error("Lote não encontrado");
      if (batch.type !== "INCOMING") throw new Error("Lote não é de entrada");
      if (batch.status === "FINISHED") throw new Error("Lote já finalizado");

      // ── 2. Busca o produto pelo EAN ────────────────────────────────────────
      let productFound = await Product.findOne({
        where: {
          [Op.or]: [{ ean: labelcode }, { ean_tribut: labelcode }],
        },
      });

      if (!productFound) {
        const supplierMapping = await SupplierMapping.findOne({
          where: { supplier_product_code: labelcode },
          include: [{ model: Product, as: "product" }],
        });

        productFound = (supplierMapping as any)?.product ?? null;
      }

      if (!productFound) throw new Error("Produto não encontrado!");

      // ── 3. Busca o BatchItem do produto neste lote (com lock) ──────────────
      const batchItem = await ExpeditionBatchItems.findOne({
        where: {
          expedition_batch_id: batchid,
          product_id: productFound.id,
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
            where: { id: invoiceId, type: "INCOMING" },
            include: [
              {
                model: InvoiceItems,
                as: "items",
                where: { product_id: productFound.id },
                required: true,
              },
            ],
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

      this.assertTransshipment(batchInvoice.invoice, unitBusiness);

      const invoiceItem = batchInvoice.invoice.items[0];

      // ── 5. Lê o InvoiceItem com lock e incrementa ──────────────────────────
      const fresh = await InvoiceItems.findByPk(invoiceItem.id, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!fresh) throw new Error("Item da nota não encontrado");

      const toIncrement = quantity;

      await InvoiceItems.increment("quantity_received", {
        by: toIncrement,
        where: { id: fresh.id },
        transaction: t,
      });

      // ── 6. Cria os ScanLogs ────────────────────────────────────────────────
      const scanLogs = Array.from({ length: toIncrement }, () => ({
        expedition_batch_id: batchid,
        expedition_batch_items_id: batchItem.id,
        expedition_batch_invoices_id: batchInvoice.id,
        label_full_code: labelcode,
        vol_number: "000000",
        user_id: userId,
      }));

      await ExpeditionScanLog.bulkCreate(scanLogs, { transaction: t });

      // ── 7. Incrementa BatchItem e total do lote ────────────────────────────
      await ExpeditionBatchItems.increment("quantity_scanned", {
        by: toIncrement,
        where: { id: batchItem.id },
        transaction: t,
      });

      await ExpeditionBatch.increment("total_volumes_received", {
        by: toIncrement,
        where: { id: batchid },
        transaction: t,
      });

      // ── 8. Verifica se todas as NFs do lote foram finalizadas ──────────────
      const pendingInvoices = await Invoice.count({
        include: [
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoice",
            where: { expedition_batch_id: batchid },
            required: true,
          },
        ],
        where: { status: { [Op.ne]: "FINISHED" } },
        transaction: t,
      });

      if (pendingInvoices === 0) {
        await ExpeditionBatch.update(
          { status: "FINISHED" },
          { where: { id: batchid }, transaction: t },
        );
      }

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
      // ── 1. Valida e bloqueia o lote ────────────────────────────────────────
      const batch = await ExpeditionBatch.findByPk(batchid, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) throw new Error("Lote não encontrado");
      if (batch.type === "INCOMING") throw new Error("Lote não é de saída");

      for (const item of items) {
        // ── 2. Busca o produto pelo productcode (igual ao scanProduct) ─────
        const productRead = (await ExpeditionBatchItems.findOne({
          where: { expedition_batch_id: batchid },
          include: [
            {
              model: Product,
              as: "product",
              where: {
                [Op.or]: [
                  { ean: item.productcode },
                  { ean_tribut: item.productcode },
                ],
              },
            },
          ],
          transaction: t,
        })) as ExpeditionBaatchItemFull;

        if (!productRead)
          throw new Error(`Produto não encontrado: ${item.productcode}`);

        // ── 3. Bloqueia o BatchItem ────────────────────────────────────────
        const batchItemLocked = (await ExpeditionBatchItems.findOne({
          where: { id: productRead.id },
          transaction: t,
          lock: t.LOCK.UPDATE,
        })) as ExpeditionBaatchItemFull;

        if (batchItemLocked.quantity_scanned < item.quantity) {
          throw new Error(
            `Quantidade a remover (${item.quantity}) maior que volumes já bipados (${batchItemLocked.quantity_scanned}) para ${item.productcode}`,
          );
        }

        // ── 4. Busca os logs a deletar — ordem decrescente por vol_number ──
        //    Cada etiqueta de saída é única (41 chars), então filtramos apenas
        //    por batch_items_id + batch_id e ordenamos desc por vol_number
        //    para remover do maior volume para o menor (4 → 3 → 2...)
        const logsToDelete = await ExpeditionScanLog.findAll({
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

        await ExpeditionScanLog.destroy({
          where: { id: logsToDelete.map((l) => l.id) },
          transaction: t,
        });

        // ── 5. Decrementa quantity_scanned no BatchItem ────────────────────
        await ExpeditionBatchItems.decrement("quantity_scanned", {
          by: item.quantity,
          where: { id: productRead.id },
          transaction: t,
        });

        await ExpeditionBatch.decrement("total_volumes_received", {
          by: item.quantity,
          where: { id: batchid },
          transaction: t,
        });

        // ── 6. Reavalia status de cada NF afetada ──────────────────────────
        //    Agrupa os logs deletados por batchInvoice para reavaliar cada NF
        const affectedInvoiceIds = [
          ...new Set(logsToDelete.map((l) => l.expedition_batch_invoices_id)),
        ];

        for (const batchInvoiceId of affectedInvoiceIds) {
          const countRemoved = logsToDelete.filter(
            (l) => l.expedition_batch_invoices_id === batchInvoiceId,
          ).length;

          const batchInvoice = (await ExpeditionBatchInvoice.findByPk(
            batchInvoiceId,
            {
              include: [{ model: Invoice, as: "invoice" }],
              transaction: t,
            },
          )) as any;

          if (!batchInvoice?.invoice) continue;

          const invoiceId = batchInvoice.invoice.id;

          await InvoiceItems.decrement("quantity_received", {
            by: countRemoved,
            where: {
              invoice_id: invoiceId,
              product_id: productRead.product_id,
            },
            transaction: t,
          });

          const pendingItem = await InvoiceItems.findOne({
            where: {
              invoice_id: invoiceId,
              [Op.and]: sequelize.literal(
                '"quantity_received" < "quantity_expected"',
              ),
            },
            transaction: t,
          });

          await Invoice.update(
            { status: pendingItem ? "PENDING" : "FINISHED" },
            { where: { id: invoiceId }, transaction: t },
          );
        }
      }

      // ── 7. Reavalia status do lote ─────────────────────────────────────────
      const pendingInvoices = await Invoice.count({
        include: [
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoice",
            where: { expedition_batch_id: batchid },
            required: true,
          },
        ],
        where: { status: { [Op.ne]: "FINISHED" } },
        transaction: t,
      });

      await ExpeditionBatch.update(
        { status: pendingInvoices === 0 ? "FINISHED" : "PENDING" },
        { where: { id: batchid }, transaction: t },
      );

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
      const batch = await ExpeditionBatch.findByPk(batchid, {
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (!batch) throw new Error("Lote não encontrado");
      if (batch.type !== "INCOMING") throw new Error("Lote não é de entrada");

      for (const item of items) {
        // ── 1. Bloqueia o BatchItem ──────────────────────────────────────────
        const batchItem = await ExpeditionBatchItems.findOne({
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

        // ── 2. Busca os logs a deletar ────────────────────────────────────────
        // Em incoming, label_full_code é o próprio EAN e vol_number é '000000'
        // então filtramos por batch_items_id e ordenamos por createdAt DESC
        const logsToDelete = await ExpeditionScanLog.findAll({
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

        await ExpeditionScanLog.destroy({
          where: { id: logsToDelete.map((l) => l.id) },
          transaction: t,
        });

        // ── 3. Decrementa BatchItem e total do lote ───────────────────────────
        await ExpeditionBatchItems.decrement("quantity_scanned", {
          by: item.quantity,
          where: { id: batchItem.id },
          transaction: t,
        });

        await ExpeditionBatch.decrement("total_volumes_received", {
          by: item.quantity,
          where: { id: batchid },
          transaction: t,
        });

        // ── 4. Reavalia status de cada NF afetada ─────────────────────────────
        const affectedInvoiceIds = [
          ...new Set(logsToDelete.map((l) => l.expedition_batch_invoices_id)),
        ];

        for (const batchInvoiceId of affectedInvoiceIds) {
          const countRemoved = logsToDelete.filter(
            (l) => l.expedition_batch_invoices_id === batchInvoiceId,
          ).length;

          const batchInvoice = (await ExpeditionBatchInvoice.findByPk(
            batchInvoiceId,
            {
              include: [{ model: Invoice, as: "invoice" }],
              transaction: t,
            },
          )) as any;

          if (!batchInvoice?.invoice) continue;

          const invoiceId = batchInvoice.invoice.id;

          await InvoiceItems.decrement("quantity_received", {
            by: countRemoved,
            where: {
              invoice_id: invoiceId,
              product_id: item.productId,
            },
            transaction: t,
          });

          const pendingItem = await InvoiceItems.findOne({
            where: {
              invoice_id: invoiceId,
              [Op.and]: sequelize.literal(
                '"quantity_received" < "quantity_expected"',
              ),
            },
            transaction: t,
          });

          await Invoice.update(
            { status: pendingItem ? "PENDING" : "FINISHED" },
            { where: { id: invoiceId }, transaction: t },
          );
        }
      }

      // ── 5. Reavalia status do lote ─────────────────────────────────────────
      const pendingInvoices = await Invoice.count({
        include: [
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoice",
            where: { expedition_batch_id: batchid },
            required: true,
          },
        ],
        where: { status: { [Op.ne]: "FINISHED" } },
        transaction: t,
      });

      await ExpeditionBatch.update(
        { status: pendingInvoices === 0 ? "FINISHED" : "PENDING" },
        { where: { id: batchid }, transaction: t },
      );

      return true;
    });
  }
}

export default new ExpeditionScanLogService();
