import { Op, Transaction } from "sequelize";
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

  async scanProduct(
    labelcode: string,
    productcode: string,
    batchid: string,
    userId: string,
  ) {
    return await sequelize.transaction(async (t) => {
      if (labelcode.length < 41) {
        throw Error("Etiqueta inválida");
      }

      const nffromlabel = labelcode.substring(14, 22);
      const eanfromlabel = labelcode.substring(23, 35);
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

      if (!invoiceRead) throw Error("Nota não encontrada no lote");

      const productRead = (await ExpeditionBatchItems.findOne({
        where: { expedition_batch_id: batchid },
        include: [
          {
            model: Product,
            as: "product",
            where: { sku: productcode },
          },
        ],
        transaction: t,
      })) as ExpeditionBaatchItemFull;

      if (!productRead) throw Error("Produto não encontrado");

      const productReadLocked = (await ExpeditionBatchItems.findOne({
        where: { id: productRead.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      })) as ExpeditionBaatchItemFull;

      productReadLocked.product = productRead.product;

      if (productReadLocked.quantity_scanned >= productReadLocked.quantity) {
        throw Error("Produto já totalmente bipado");
      }

      if (productRead.product.ean != eanfromlabel) {
        throw Error("Etiqueta não pertencente ao produto lido!");
      }

      try {
        await ExpeditionScanLog.create(
          {
            expedition_batch_items_id: productRead.id,
            expedition_batch_invoices_id: invoiceRead?.batchInvoices?.[0].id,
            expedition_batch_id: invoiceRead.id,
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

      const allDone = await InvoiceItems.count({
        where: {
          invoice_id: invoiceId,
          quantity_received: { [Op.lt]: sequelize.col("quantity_expected") },
        },
        transaction: t,
      });

      if (allDone === 0) {
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

      // ── 2. Resolve produto via SupplierMapping ─────────────────────────────
      //    Busca todos os mappings com aquele supplier_product_code e filtra
      //    pelo sender_cnpj das invoices do lote — evita conflito quando o
      //    mesmo código de produto existe em múltiplos fornecedores
      const supplierMapping = await SupplierMapping.findOne({
        where: { supplier_product_code: labelcode },
        include: [
          {
            model: Product,
            as: "product",
            required: true,
          },
        ],
        transaction: t,
      });

      if (!supplierMapping) {
        throw new Error(
          `Código "${labelcode}" não encontrado no mapeamento de fornecedores`,
        );
      }

      // ── 3. Busca o BatchItem do produto neste lote ─────────────────────────
      const batchItem = await ExpeditionBatchItems.findOne({
        where: {
          expedition_batch_id: batchid,
          product_id: supplierMapping.product_id,
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

      // ── 4. Valida quantidade ───────────────────────────────────────────────
      if (batchItem.quantity_scanned >= batchItem.quantity) {
        throw new Error(
          `Quantidade máxima já recebida para este produto (${batchItem.quantity} unidades)`,
        );
      }

      // ── 5. Cria ScanLog e incrementa quantity_scanned no BatchItem ─────────
      //    Nota: label_full_code aqui é o código do fornecedor, não tem
      //    unicidade global — a mesma etiqueta pode chegar em lotes diferentes.
      //    A unicidade é garantida por (label_full_code, expedition_batch_id).
      //    TODO: avaliar adicionar unique constraint composto na migration
      await ExpeditionScanLog.create(
        {
          expedition_batch_id: batchid,
          expedition_batch_items_id: batchItem.id,
          // INCOMING não tem nota vinculada por volume individual — usa a
          // primeira batchInvoice do lote que contenha este produto
          expedition_batch_invoices_id: await this.resolveInvoiceForItem(
            batchid,
            supplierMapping.product_id,
            t,
          ),
          label_full_code: labelcode,
          vol_number: "000000", 
          user_id: userId,
        },
        { transaction: t },
      );

      await ExpeditionBatchItems.increment("quantity_scanned", {
        by: 1,
        where: { id: batchItem.id },
        transaction: t,
      });

      await ExpeditionBatch.increment("total_volumes_received", {
        by: 1,
        where: {id: batchid},
        transaction: t,
      })

      // ── 6. Atualiza quantity_received no InvoiceItem ───────────────────────
      //    Busca o InvoiceItem da NF de entrada correspondente ao produto
      const batchInvoice = await ExpeditionBatchInvoice.findOne({
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
                where: { product_id: supplierMapping.product_id },
                required: true,
              },
            ],
            required: true,
          },
        ],
        transaction: t,
      }) as any;

      if (!batchInvoice?.invoice?.items?.[0]) {
        throw new Error("Item da nota fiscal não encontrado para este produto");
      }

      const invoiceItem = batchInvoice.invoice.items[0];
      const invoiceId = batchInvoice.invoice.id;

      await InvoiceItems.increment("quantity_received", {
        by: 1,
        where: { id: invoiceItem.id },
        transaction: t,
      });

      // ── 7. Verifica se todos os itens da NF foram recebidos ────────────────
      const pendingInvoiceItems = await InvoiceItems.count({
        where: {
          invoice_id: invoiceId,
          quantity_received: { [Op.lt]: sequelize.col("quantity_expected") },
        },
        transaction: t,
      });

      if (pendingInvoiceItems === 0) {
        await Invoice.update(
          { status: "FINISHED" },
          { where: { id: invoiceId }, transaction: t },
        );
      }

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

        // TODO: gerar NF-e na Bling a partir do XML das invoices do lote
        //       - descriptografar xml_path de cada invoice
        //       - parsear XML e montar corpo da requisição
        //       - POST /nfe na API Bling da unit_business receptora
        //       - atualizar Invoice.batch_generated = true
      }

      return true;
    });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Helper — resolve qual ExpeditionBatchInvoice usar para o ScanLog
  // Busca a primeira batchInvoice do lote cuja invoice contenha o produto
  // ─────────────────────────────────────────────────────────────────────────────
  private async resolveInvoiceForItem(
    batchid: string,
    productId: string,
    t: Transaction,
  ): Promise<string> {
    const batchInvoice = await ExpeditionBatchInvoice.findOne({
      where: { expedition_batch_id: batchid },
      include: [
        {
          model: Invoice,
          as: "invoice",
          include: [
            {
              model: InvoiceItems,
              as: "items",
              where: { product_id: productId },
              required: true,
            },
          ],
          required: true,
        },
      ],
      transaction: t,
    });

    if (!batchInvoice) {
      throw new Error(
        "Não foi possível vincular o scan a uma nota fiscal do lote",
      );
    }

    return batchInvoice.id;
  }

}

export default new ExpeditionScanLogService();
