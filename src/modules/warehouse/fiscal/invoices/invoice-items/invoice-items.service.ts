import { Transaction } from "sequelize";
import sequelize from "../../../../../config/sequelize";
import BaseService from "../../../../../shared/utils/base-models/base-service";
import { Product, ProductConfig } from "../../../../inventory";
import supplierMappingService from "../../../../inventory/supplier-mapping/supplier-mapping.service";
import UnmappedInvoiceProduct from "../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import unmappedInvoiceProductService from "../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
import batchInvoiceItemsService from "../../../expedition/batch-invoice-items/batch-invoice-items.service";
import ExpeditionBatchInvoice from "../../../expedition/batch-invoices/batch-invoices.model";
import batchInvoicesService from "../../../expedition/batch-invoices/batch-invoices.service";
import ExpeditionBatchItems from "../../../expedition/batch-items/batch-items.model";
import batchItemsService from "../../../expedition/batch-items/batch-items.service";
import ExpeditionBatch from "../../../expedition/batch/batch.model";
import batchService from "../../../expedition/batch/batch.service";
import InvoiceFiscalItem from "../invoice-fiscal-item/invoice-fiscal-item.model";
import invoiceService from "../invoice/invoice.service";
import InvoiceItems from "./invoice-items.model";
import invoiceItemsRepository, {
  InvoiceItemsRepository,
} from "./invoice-items.repository";
import { resolveIntegrationsIdForUnitBusiness } from "../../../../handlers/tecinco/queues/helpers/product.helpers";

export class InvoiceItemsService extends BaseService<
  InvoiceItems,
  InvoiceItemsRepository
> {
  constructor() {
    super(invoiceItemsRepository);
  }

  // Único disparador de cascata: mapear (manualmente, via POST /add/item)
  // UM unmapped pra um product_id — seja esse produto novo (acabou de ser
  // criado a partir de outro unmapped, ver
  // UnmappedInvoiceProductService.resolveFromCreatedProduct, que NÃO
  // cascateia sozinho) ou já existente — sempre avalia, ao final, outros
  // unmapped "irmãos" (mesmo código de fornecedor, mesmo CNPJ emissor) pra
  // auto-mapear também (ver cascadeAutoMapUnmapped).
  async createInvoiceItemForUnmappedProducts(
    invoiceItemDto: Partial<InvoiceItems>,
    newEan: string,
    unMappedProductId: string,
  ): Promise<void> {
    return sequelize.transaction((t) =>
      this.createInvoiceItemForUnmappedProductsInTx(
        t,
        invoiceItemDto,
        newEan,
        unMappedProductId,
      ),
    );
  }

  // Corpo transacional de createInvoiceItemForUnmappedProducts, extraído
  // pra ser reaproveitado pela cascata de auto-mapeamento (ver
  // cascadeAutoMapUnmapped) — que precisa rodar esse mesmo fluxo pra outros
  // unmapped "irmãos", na MESMA transação, sem duplicar a lógica.
  //
  // triggerCascade: só true na chamada raiz (o mapeamento manual que o
  // usuário disparou). cascadeAutoMapUnmapped já busca TODOS os siblings de
  // uma vez só e distribui um por um pra essa função — se cada sibling
  // também disparasse sua própria cascata, a busca rodaria de novo pra cada
  // um (redundante) e o mesmo sibling podia ser alcançado por mais de um
  // caminho recursivo ao mesmo tempo. Por isso as chamadas feitas de DENTRO
  // de cascadeAutoMapUnmapped passam triggerCascade: false.
  private async createInvoiceItemForUnmappedProductsInTx(
    t: Transaction,
    invoiceItemDto: Partial<InvoiceItems>,
    newEan: string,
    unMappedProductId: string,
    triggerCascade: boolean = true,
  ): Promise<void> {
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

      if (!invoice) {
        throw new Error("Invoice não encontrada!");
      }

      const incomingAttr = invoice.unitBusinessAttributes?.find(
        (attr) => attr.type === "INCOMING",
      );

      if (incomingAttr?.status !== "WAITING_SCHEDULE_SALES") {
        await invoiceService.updateInvoicesForAllUnitBusiness(
          [invoiceItemDto.invoice_id!],
          { status: "OPEN" },
        );
      } else {
        console.log(
          `[INVOICE_ITEMS] Invoice ${invoice.id} está em WAITING_SCHEDULE_SALES na unit business de entrada, status mantido.`,
        );
      }

      // ─── 2. Cria o InvoiceFiscalItem ──────────────────────────────────────
      // Os totais da invoice já estão corretos desde o upsert do Bling/XML,
      // pois refletem todos os itens da NF-e independente de mapeamento.
      // Aqui apenas registramos o item fiscal para rastreabilidade interna.
      // Impostos ficam zerados — sem XML completo neste fluxo manual;
      // serão preenchidos quando o XML for reprocessado pelo Bling.
      const unitBusinessId =
        invoice.unitBusinessAttributes?.[0]?.unit_business_id;

      const product = await Product.findByPk(invoiceItemDto.product_id, {
        include: [
          {
            model: ProductConfig,
            as: "productConfigs",
            required: false,
            where: unitBusinessId
              ? { unit_business_id: unitBusinessId }
              : undefined,
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
          gtin: newEan || unMappedProduct.ean || config?.gtin || null,
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
          conflictFields: ["invoice_id", "product_id"] as any,
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

      // ─── 4. Cria ou reaproveita o SupplierMapping se for nota de entrada ──

      if (incomingAttr) {
        const supplierProductCode =
          newEan ?? unMappedProduct.ean ?? unMappedProduct.sku;

        if (supplierProductCode) {
          const integrationsId = await resolveIntegrationsIdForUnitBusiness(
            incomingAttr.unit_business_id,
            t,
          );

          const existingSupplierMapping = await supplierMappingService.findOne({
            where: {
              product_id: invoiceItemDto.product_id,
              supplier_product_code: supplierProductCode,
              integrations_id: integrationsId,
            },
            transaction: t,
          });

          if (existingSupplierMapping) {
            console.log(
              `[INVOICE_ITEMS] SupplierMapping já existente reaproveitado: product_id=${invoiceItemDto.product_id}, code=${supplierProductCode}`,
            );
          } else {
            if (supplierProductCode) {
            const spMap = await supplierMappingService.create(
              {
                product_id: invoiceItemDto.product_id,
                supplier_cnpj: invoice.sender_cnpj,
                supplier_product_code: supplierProductCode,
                integrations_id: integrationsId,
              },
              { transaction: t },
            );


            console.log(
              `[INVOICE_ITEMS] SupplierMapping criado: product_id=${invoiceItemDto.product_id}, cnpj=${invoice.sender_cnpj}, code=${supplierProductCode}`,
            );
            console.log(spMap);

            }
          }
        }
      }

      // ─── 5. Remove o UnmappedInvoiceProduct ──────────────────────────────
      await unmappedInvoiceProductService.delete(unMappedProductId, {
        transaction: t,
      });

      // ─── 6. Cascata: outros unmapped do mesmo fornecedor com o mesmo
      // código de fornecedor podem ser mapeados automaticamente também —
      // ver cascadeAutoMapUnmapped. Só dispara na chamada raiz (ver
      // triggerCascade acima) — os siblings processados pela própria
      // cascata não disparam uma busca nova cada um.
      if (triggerCascade) {
        await this.cascadeAutoMapUnmapped(t, {
          productId: invoiceItemDto.product_id,
          supplierProductCode:
            newEan || unMappedProduct.ean || unMappedProduct.sku,
          senderCnpj: invoice.sender_cnpj,
          excludeId: unMappedProductId,
        });
      }
  }

  // Depois de mapear um unmapped manualmente, avalia se outros unmapped (em
  // outras notas) com o mesmo código de fornecedor e a mesma nota de
  // origem (mesmo CNPJ emissor) também podem ser resolvidos pro mesmo
  // produto — só nesse caso é seguro assumir automaticamente, já que o
  // mesmo EAN pode legitimamente ser de produtos diferentes entre
  // fornecedores diferentes (ver findCascadeMatches). Busca TODOS os
  // siblings de uma vez só (uma única query) e processa cada um com
  // triggerCascade: false — nenhum deles dispara uma busca nova, então cada
  // sibling é tocado exatamente uma vez, sem recursão nem redundância.
  private async cascadeAutoMapUnmapped(
    t: Transaction,
    params: {
      productId: string;
      supplierProductCode: string | null;
      senderCnpj: string;
      excludeId: string;
    },
  ): Promise<void> {
    const matches = await unmappedInvoiceProductService.findCascadeMatches(
      {
        supplierProductCode: params.supplierProductCode,
        excludeId: params.excludeId,
        senderCnpj: params.senderCnpj,
      },
      t,
    );

    for (const match of matches) {
      await this.createInvoiceItemForUnmappedProductsInTx(
        t,
        {
          product_id: params.productId,
          invoice_id: match.invoice_id!,
          quantity_expected: match.quantity ?? 0,
        },
        match.ean ?? "",
        match.id,
        false,
      );
    }
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

      const batch = await batchService.findById(
        batchInvoice.expedition_batch_id,
        { transaction: t },
      );

      if (!batch) {
        throw new Error("Batch não encontrado!");
      }

      if (batch.status === "FINISHED") {
        console.log(
          `[SYNC_BATCH] Batch ${batch.id} já finalizado, sync ignorado.`,
        );
        return;
      }

      const invoiceUnitBusinessAttr = invoice.unitBusinessAttributes?.find(
        (uba) => uba.unit_business_id === batch.unit_business_id,
      );

      if (!invoiceUnitBusinessAttr) {
        console.log(
          `[SYNC_BATCH] Nenhum InvoiceUnitBusinessAttributes encontrado para unit_business ${batch.unit_business_id}, sync ignorado.`,
        );
        return;
      }

      if (invoiceUnitBusinessAttr.status === "FINISHED") {
        console.log(
          `[SYNC_BATCH] Invoice ${batchInvoice.invoice_id} já finalizada para unit_business ${batch.unit_business_id}, sync ignorado.`,
        );
        return;
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
