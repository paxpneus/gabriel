import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { Product } from "../../../inventory";
import supplierMappingService from "../../../inventory/supplier-mapping/supplier-mapping.service";
import UnmappedInvoiceProduct from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import ExpeditionBatchInvoice from "../../expedition/batch-invoices/batch-invoices.model";
import ExpeditionBatchItems from "../../expedition/batch-items/batch-items.model";
import ExpeditionBatch from "../../expedition/batch/batch.model";
import InvoiceFiscalItem from "../invoice-fiscal-item/invoice-fiscal-item.model";
import Invoice from "../invoice/invoice.model";
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

      const unMappedProduct = await UnmappedInvoiceProduct.findByPk(
        unMappedProductId,
        { transaction: t },
      );

      if (!unMappedProduct) {
        throw new Error("Produto não mapeado não encontrado!");
      }

      if (unMappedProduct.quantity != invoiceItemDto.quantity_expected) {
        throw new Error("Quantidade do item divergente da quantidade da nota");
      }

      // ─── 1. Cria o InvoiceItem operacional ───────────────────────────────
      const invoiceItem = await this.create(invoiceItemDto, { transaction: t });

      const invoice = await invoiceService.findById(invoiceItemDto.invoice_id!, {
        transaction: t,
      });

      if (!invoice) {
        throw new Error("Invoice não encontrada!");
      }

      // ─── 2. Cria o InvoiceFiscalItem ─────────────────────────────────────
      // Busca o produto para complementar com NCM, CEST e preço
      const product = await Product.findByPk(invoiceItemDto.product_id, {
        transaction: t,
      });

      const quantity = unMappedProduct.quantity ?? 0;
      // Tenta usar unit_price do dto; fallback para supplier_cost_price do produto
      const unitPrice =
        (invoiceItemDto as any).unit_price ??
        Number(product?.supplier_cost_price ?? 0);
      const totalValue = unitPrice * quantity;

      // Descobre o próximo item_number para esta invoice
      const existingFiscalItemsCount = await InvoiceFiscalItem.count({
        where: { invoice_id: invoice.id },
        transaction: t,
      });
      const nextItemNumber = existingFiscalItemsCount + 1;

      await InvoiceFiscalItem.upsert(
        {
          invoice_id: invoice.id,
          product_id: product?.id ?? null,
          item_number: nextItemNumber,
          sku: product?.sku ?? unMappedProduct.sku ?? null,
          description: unMappedProduct.product_name?.slice(0, 255) ?? null,
          quantity,
          unit_price: unitPrice,
          total_value: totalValue,
          ncm: product?.ncm ?? null,
          cest: product?.cest ?? null,
          cfop: null,
          gtin: newEan || unMappedProduct.ean || product?.ean || null,
          // Impostos ficam zerados — não temos XML completo neste fluxo manual.
          // Serão preenchidos quando o XML da NF-e for processado pelo Bling.
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

      // ─── 3. Incrementa os totais da Invoice principal ─────────────────────
      // Apenas incrementa invoice_products_value e invoice_value com o valor
      // do item recém mapeado, sem recalcular campos fiscais (esses virão do XML).
      await Invoice.increment(
        {
          invoice_products_value: totalValue,
          invoice_value: totalValue,
        },
        {
          where: { id: invoice.id },
          transaction: t,
        },
      );

      console.log(
        `[INVOICE_ITEMS] FiscalItem criado e invoice ${invoice.id} incrementada em +${totalValue} (produto ${product?.sku})`,
      );

      // ─── 4. Sincroniza batch se a invoice já pertencer a um ───────────────
      if (invoice?.batch_generated) {
        const batchInvoices = await ExpeditionBatchInvoice.findAll({
          where: { invoice_id: invoice.id },
          transaction: t,
        });

        const uniqueBatchIds = [
          ...new Set(batchInvoices.map((b) => b.expedition_batch_id)),
        ];

        await Promise.all(
          uniqueBatchIds.map(async (expedition_batch_id) => {
            await ExpeditionBatchItems.create(
              {
                expedition_batch_id,
                product_id: invoiceItemDto.product_id!,
                quantity: invoiceItemDto.quantity_expected!,
                quantity_scanned: 0,
              },
              { transaction: t },
            );

            await ExpeditionBatch.increment("total_volumes", {
              by: invoiceItemDto.quantity_expected,
              where: { id: expedition_batch_id },
              transaction: t,
            });

            await ExpeditionBatch.update(
              { status: "PENDING" },
              { where: { id: expedition_batch_id }, transaction: t },
            );
          }),
        );
      }

      // ─── 5. Cria SupplierMapping se for nota de entrada ───────────────────
      if (invoice.type === "INCOMING") {
        const supplierProductCode = newEan || unMappedProduct?.ean;

        if (supplierProductCode) {
          const spMap = await supplierMappingService.create(
            {
              product_id: invoiceItemDto.product_id,
              supplier_cnpj: invoice?.sender_cnpj,
              supplier_product_code: supplierProductCode,
            },
            { transaction: t },
          );

          console.log(
            `[INVOICE_ITEMS] SupplierMapping criado: product_id=${invoiceItemDto.product_id}, cnpj=${invoice?.sender_cnpj}`,
          );
          console.log(spMap);
        }
      }

      // ─── 6. Remove o UnmappedInvoiceProduct ──────────────────────────────
      await UnmappedInvoiceProduct.destroy({
        where: { id: unMappedProductId },
        transaction: t,
      });
    });
  }
}

export default new InvoiceItemsService();