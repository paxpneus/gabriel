import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { Product, ProductConfig } from "../../../inventory";
import supplierMappingService from "../../../inventory/supplier-mapping/supplier-mapping.service";
import UnmappedInvoiceProduct from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import unmappedInvoiceProductService from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
import batchInvoiceItemsService from "../../expedition/batch-invoice-items/batch-invoice-items.service";
import ExpeditionBatchInvoice from "../../expedition/batch-invoices/batch-invoices.model";
import batchInvoicesService from "../../expedition/batch-invoices/batch-invoices.service";
import ExpeditionBatchItems from "../../expedition/batch-items/batch-items.model";
import batchItemsService from "../../expedition/batch-items/batch-items.service";
import ExpeditionBatch from "../../expedition/batch/batch.model";
import batchService from "../../expedition/batch/batch.service";
import InvoiceFiscalItem from "../invoice-fiscal-item/invoice-fiscal-item.model";
import invoiceService from "../invoice/invoice.service";
import InvoiceItems from "./invoice-items.model";
import invoiceItemsRepository, {
  InvoiceItemsRepository,
} from "./invoice-items.repository";

export class InvoiceItemsService extends BaseService<
  InvoiceItems,
  InvoiceItemsRepository
> {
  constructor() {
    super(invoiceItemsRepository);
  }

  async createInvoiceItem(
    invoiceItemDto: Partial<InvoiceItems>,
    newEan: string,
    unMappedProductId: string,
  ): Promise<void> {
    return sequelize.transaction(async (t) => {
      if (!invoiceItemDto.product_id) {
        throw new Error("Produto não encontrado!");
      }

      const unMappedProduct = await unmappedInvoiceProductService.findById(
        unMappedProductId,
        { transaction: t },
      );

      if (!unMappedProduct) {
        throw new Error("Produto não mapeado não encontrado!");
      }

      if (unMappedProduct.quantity != invoiceItemDto.quantity_expected) {
        throw new Error("Quantidade do item divergente da quantidade da nota");
      }

      // ─── 1. Cria o InvoiceItem operacional e atualiza invoice status ───────────────────────────────
      await this.create(invoiceItemDto, { transaction: t });

      const invoice = await invoiceService.findByIdFullForAllUnits(
        invoiceItemDto.invoice_id!,
      );

      await invoiceService.updateInvoicesForAllUnitBusiness(
        [invoiceItemDto.invoice_id!],
        { status: "OPEN" },
      );

      if (!invoice) {
        throw new Error("Invoice não encontrada!");
      }

      // ─── 2. Cria o InvoiceFiscalItem ──────────────────────────────────────
      // Os totais da invoice já estão corretos desde o upsert do Bling/XML,
      // pois refletem todos os itens da NF-e independente de mapeamento.
      // Aqui apenas registramos o item fiscal para rastreabilidade interna.
      // Impostos ficam zerados — sem XML completo neste fluxo manual;
      // serão preenchidos quando o XML for reprocessado pelo Bling.
      const product = await Product.findByPk(invoiceItemDto.product_id, {
        include: [
          {
            model: ProductConfig,
            as: "productConfigs",
            required: false,
            where: { unit_business_id: invoice.unit_business_id },
          },
        ],
        transaction: t,
      });

      const config = (product as any)?.productConfigs?.[0];

      const quantity = unMappedProduct.quantity ?? 0;
      const unitPrice = Number(config?.supplier_cost_price ?? 0);
      const totalValue = unitPrice * quantity;

      const existingFiscalItemsCount = await InvoiceFiscalItem.count({
        where: { invoice_id: invoice.id },
        transaction: t,
      });

      await InvoiceFiscalItem.upsert(
        {
          invoice_id: invoice.id,
          product_id: product?.id ?? null,
          item_number: existingFiscalItemsCount + 1,
          sku: config?.sku ?? unMappedProduct.sku ?? null,
          description: unMappedProduct.product_name?.slice(0, 255) ?? null,
          quantity,
          unit_price: unitPrice,
          total_value: totalValue,
          ncm: config?.ncm ?? null,
          cest: config?.cest ?? null,
          cfop: null,
          gtin: newEan || unMappedProduct.ean || product?.ean || null,
          approx_tax_value: 0,
          icms_rate: 0,
          icms_value: 0,
          ipi_value: 0,
          pis_value: 0,
          cofins_value: 0,
          difal_value: 0,
          ibs_value: 0,
          cbs_value: 0,
        },
        {
          conflictFields: ["invoice_id", "item_number"] as any,
          transaction: t,
        },
      );

      console.log(
        `[INVOICE_ITEMS] FiscalItem criado para invoice ${invoice.id} | produto=${config?.sku} | qty=${quantity}`,
      );

      // ─── 3. Sincroniza batch se a invoice já pertencer a um ───────────────
      if (invoice.unitBusinessAttributes?.some((s) => s.batch_generated)) {
        const batchInvoices = await batchInvoicesService.findAll({
          where: { invoice_id: invoice.id },
          transaction: t,
        });

        const uniqueBatchIds = [
          ...new Set(batchInvoices.map((b) => b.expedition_batch_id)),
        ];

        await Promise.all(
          uniqueBatchIds.map(async (expedition_batch_id) => {
            const existingItem = await batchItemsService.findOne({
              where: {
                expedition_batch_id,
                product_id: invoiceItemDto.product_id!,
              },
              transaction: t,
            });

            if (existingItem) {
              await batchItemsService.increment("quantity", {
                by: invoiceItemDto.quantity_expected ?? 0,
                where: { id: existingItem.id },
                transaction: t,
              });
            } else {
              await batchItemsService.create(
                {
                  expedition_batch_id,
                  product_id: invoiceItemDto.product_id!,
                  quantity: invoiceItemDto.quantity_expected!,
                  quantity_scanned: 0,
                },
                { transaction: t },
              );
            }

            await batchService.increment("total_volumes", {
              by: invoiceItemDto.quantity_expected ?? 0,
              where: { id: expedition_batch_id },
              transaction: t,
            });

            await batchService.update(
              expedition_batch_id,
              { status: "PENDING" },
              { transaction: t },
            );

            // busca o batch_invoice para essa combinação batch + invoice
            const batchInvoice = batchInvoices.find(
              (b) => b.expedition_batch_id === expedition_batch_id,
            );

            if (batchInvoice) {
              // pega o batch_item que acabamos de criar/incrementar
              const batchItem = await batchItemsService.findOne({
                where: {
                  expedition_batch_id,
                  product_id: invoiceItemDto.product_id!,
                },
                transaction: t,
              });

              if (batchItem) {
                const existingBatchInvoiceItem =
                  await batchInvoiceItemsService.findOne({
                    where: {
                      expedition_batch_invoice_id: batchInvoice.id,
                      expedition_batch_item_id: batchItem.id,
                    },
                    transaction: t,
                  });

                if (existingBatchInvoiceItem) {
                  await batchInvoiceItemsService.increment(
                    "quantity_expected",
                    {
                      by: invoiceItemDto.quantity_expected ?? 0,
                      where: { id: existingBatchInvoiceItem.id },
                      transaction: t,
                    },
                  );

                  await batchInvoiceItemsService.update(
                    existingBatchInvoiceItem.id,
                    { status: "PENDING" },
                    { transaction: t },
                  );
                } else {
                  await batchInvoiceItemsService.create(
                    {
                      expedition_batch_invoice_id: batchInvoice.id,
                      expedition_batch_item_id: batchItem.id,
                      quantity_expected: invoiceItemDto.quantity_expected!,
                      quantity_read: 0,
                      status: "PENDING",
                    },
                    { transaction: t },
                  );
                }
              }
            }
          }),
        );
      }

      const incomingAttr = invoice.unitBusinessAttributes?.find(
        (attr) => attr.type === "INCOMING",
      );
      // ─── 4. Cria SupplierMapping se for nota de entrada ───────────────────
      if (incomingAttr) {
        const supplierProductCode =
          newEan ?? unMappedProduct.ean ?? unMappedProduct.sku;

        if (supplierProductCode) {
          const spMap = await supplierMappingService.create(
            {
              product_id: invoiceItemDto.product_id,
              supplier_cnpj: invoice.sender_cnpj,
              supplier_product_code: supplierProductCode,
            },
            { transaction: t },
          );

          console.log(
            `[INVOICE_ITEMS] SupplierMapping criado: product_id=${invoiceItemDto.product_id}, cnpj=${invoice.sender_cnpj}`,
          );
          console.log(spMap);
        }
      }

      // ─── 5. Remove o UnmappedInvoiceProduct ──────────────────────────────
      await unmappedInvoiceProductService.delete(unMappedProductId, {
        transaction: t,
      });
    });
  }

  async syncBatchFromInvoice(
    batchInvoice: ExpeditionBatchInvoice,
  ): Promise<void> {
    return sequelize.transaction(async (t) => {
      const invoice = await invoiceService.findByIdFullForAllUnits(
        batchInvoice.invoice_id,
      );

      if (!invoice) {
        throw new Error("Invoice não encontrada!");
      }

      const invoiceItems = await this.findAll({
        where: { invoice_id: batchInvoice.invoice_id },
        transaction: t,
      });

      if (!invoiceItems.length) {
        console.log(
          `[SYNC_BATCH] Nenhum InvoiceItem encontrado para invoice ${batchInvoice.invoice_id}`,
        );
        return;
      }

      const expedition_batch_id = batchInvoice.expedition_batch_id;

      await Promise.all(
        invoiceItems.map(async (invoiceItem) => {
          const quantityExpected = invoiceItem.quantity_expected ?? 0;

          // ─── Upsert BatchItem ──────────────────────────────────────────────
          const existingBatchItem = await batchItemsService.findOne({
            where: {
              expedition_batch_id,
              product_id: invoiceItem.product_id!,
            },
            transaction: t,
          });

          let batchItem: ExpeditionBatchItems;

          if (existingBatchItem) {
            // Detecta se a quantidade mudou comparando com o que já está no batch invoice item
            const existingBatchInvoiceItem =
              await batchInvoiceItemsService.findOne({
                where: {
                  expedition_batch_invoice_id: batchInvoice.id,
                  expedition_batch_item_id: existingBatchItem.id,
                },
                transaction: t,
              });

            const previousQty =
              existingBatchInvoiceItem?.quantity_expected ?? 0;
            const diff = quantityExpected - previousQty;

            if (diff !== 0) {
              await batchItemsService.increment("quantity", {
                by: diff,
                where: { id: existingBatchItem.id },
                transaction: t,
              });

              await batchService.increment("total_volumes", {
                by: diff,
                where: { id: expedition_batch_id },
                transaction: t,
              });
            }

            batchItem = existingBatchItem;
          } else {
            batchItem = await batchItemsService.create(
              {
                expedition_batch_id,
                product_id: invoiceItem.product_id!,
                quantity: quantityExpected,
                quantity_scanned: 0,
              },
              { transaction: t },
            );

            await batchService.increment("total_volumes", {
              by: quantityExpected,
              where: { id: expedition_batch_id },
              transaction: t,
            });
          }

          // ─── Upsert BatchInvoiceItem ───────────────────────────────────────
          const existingBatchInvoiceItem =
            await batchInvoiceItemsService.findOne({
              where: {
                expedition_batch_invoice_id: batchInvoice.id,
                expedition_batch_item_id: batchItem.id,
              },
              transaction: t,
            });

          if (existingBatchInvoiceItem) {
            await batchInvoiceItemsService.update(
              existingBatchInvoiceItem.id,
              {
                quantity_expected: quantityExpected,
                status: "PENDING",
              },
              { transaction: t },
            );
          } else {
            await batchInvoiceItemsService.create(
              {
                expedition_batch_invoice_id: batchInvoice.id,
                expedition_batch_item_id: batchItem.id,
                quantity_expected: quantityExpected,
                quantity_read: 0,
                status: "PENDING",
              },
              { transaction: t },
            );
          }

          console.log(
            `[SYNC_BATCH] Sincronizado product_id=${invoiceItem.product_id} | qty=${quantityExpected} | batch=${expedition_batch_id}`,
          );
        }),
      );

      // ─── Atualiza status do Batch ──────────────────────────────────────────
      await batchService.update(
        expedition_batch_id,
        { status: "PENDING" },
        { transaction: t },
      );

      console.log(
        `[SYNC_BATCH] Batch ${expedition_batch_id} sincronizado para invoice ${batchInvoice.invoice_id}`,
      );
    });
  }
}

export default new InvoiceItemsService();
