import sequelize from "../../../../config/sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import { Product, ProductConfig } from "../../../inventory";
import supplierMappingService from "../../../inventory/supplier-mapping/supplier-mapping.service";
import UnmappedInvoiceProduct from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import ExpeditionBatchInvoice from "../../expedition/batch-invoices/batch-invoices.model";
import ExpeditionBatchItems from "../../expedition/batch-items/batch-items.model";
import ExpeditionBatch from "../../expedition/batch/batch.model";
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
      await this.create(invoiceItemDto, { transaction: t });

      const invoice = await invoiceService.findById(
        invoiceItemDto.invoice_id!,
        {
          transaction: t,
        },
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
          sku: config?.sku  ?? unMappedProduct.sku ?? null,
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
      if (invoice.batch_generated) {
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

      // ─── 4. Cria SupplierMapping se for nota de entrada ───────────────────
      if (invoice.type === "INCOMING") {
        const supplierProductCode = newEan || unMappedProduct.ean;

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
      await UnmappedInvoiceProduct.destroy({
        where: { id: unMappedProductId },
        transaction: t,
      });
    });
  }
}

export default new InvoiceItemsService();
