import BaseService from "../../../../shared/utils/base-models/base-service";
import ExpeditionBatch from "./batch.model";
import expeditionBatchRepository, {
  ExpeditionBatchRepository,
} from "./batch.repository";
import ExpeditionBatchInvoice from "../batch-invoices/batch-invoices.model";
import ExpeditionBatchItems from "../batch-items/batch-items.model";
import InvoiceItems from "../../entrance/invoice-items/invoice-items.model";
import Invoice from "../../entrance/invoice/invoice.model";
import sequelize from "../../../../config/sequelize";
import { Product, Stock } from "../../../inventory";
import ExpeditionScanLog from "../scan-logs/scan-logs.model";
import { ExpeditionBatchFull } from "./batch.types";
import { InvoiceItemsAttributes } from "../../entrance/invoice-items/invoice-items.types";

export class ExpeditionBatchService extends BaseService<
  ExpeditionBatch,
  ExpeditionBatchRepository
> {
  constructor() {
    super(expeditionBatchRepository);
  }

  async generateBatchFromInvoices(
    invoiceIds: string[],
  ): Promise<ExpeditionBatch> {
    return await sequelize.transaction(async (t) => {
      const invoices = await Invoice.findAll({
        where: { id: invoiceIds },
        include: [{ model: InvoiceItems, as: "items", required: true }],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      if (invoices.length !== invoiceIds.length) {
        const foundIds = invoices.map((i) => i.id);
        const missing = invoiceIds.filter((id) => !foundIds.includes(id));
        throw new Error(`Notas sem itens: ${missing.join(", ")}`);
      }

      const semItens = invoices.filter((i) => !(i as any).items?.length);
      if (semItens.length) {
        throw new Error(
          `As seguintes notas não possuem itens: ${semItens.map((i) => i.number_system).join(", ")}`,
        );
      }

      if (!invoices.length) {
        throw new Error("Nenhuma nota encontrada");
      }

      const alreadyBatched = invoices.filter((i) => i.batch_generated);
      const notBatched = invoices.filter((i) => !i.batch_generated);

      if (alreadyBatched.length > 0 && notBatched.length > 0) {
        const alreadyBatchedNumbers = alreadyBatched
          .map((i) => i.number_system)
          .join(", ");
        throw new Error(
          `Não é permitido misturar notas já processadas com novas. ` +
            `notas já processadas: ${alreadyBatchedNumbers}`,
        );
      }

      if (alreadyBatched.length > 0 && notBatched.length === 0) {
        const batchInvoice = await ExpeditionBatchInvoice.findOne({
          where: { invoice_id: invoices[0].id },
          transaction: t,
        });

        if (!batchInvoice) {
          throw new Error("Lote não encontrado para notas já processadas");
        }

        return (await ExpeditionBatch.findByPk(
          batchInvoice.expedition_batch_id,
          {
            include: [
              {
                model: ExpeditionBatchItems,
                as: "items",
                separate: true,
                include: [
                  {
                    model: Product,
                    as: "product",
                    include: [{ model: Stock, as: "stocks" }],
                  },
                ],
              },
              {
                model: ExpeditionBatchInvoice,
                as: "batchInvoices",
                separate: true,
              },
            ],
            transaction: t,
          },
        )) as ExpeditionBatch;
      }

      const batchNumber = `LOTE-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase()}`;

      const batch = await ExpeditionBatch.create(
        {
          number: batchNumber,
          status: "OPEN",
          unit_business_id: invoices[0].unit_business_id,
          total_volumes: 0,
          integrations_id: invoices[0].integrations_id,
        },
        { transaction: t },
      );

      let totalVolumes = 0;
      const batchInvoicesPayload: any[] = [];

      const itemsByProduct = new Map<
        string,
        { product_id: string; quantity: number }
      >();

      for (const invoice of notBatched) {
        batchInvoicesPayload.push({
          expedition_batch_id: batch.id,
          invoice_id: invoice.id,
        });

        const items = (invoice as any).items ?? [];

        for (const item of items) {
          const existing = itemsByProduct.get(item.product_id);
          if (existing) {
            existing.quantity += item.quantity_expected;
          } else {
            itemsByProduct.set(item.product_id, {
              product_id: item.product_id,
              quantity: item.quantity_expected,
            });
          }
          totalVolumes += item.quantity_expected;
        }
      }

      const batchItemsPayload = Array.from(itemsByProduct.values()).map(
        (item) => ({
          expedition_batch_id: batch.id,
          product_id: item.product_id,
          quantity: item.quantity,
          quantity_scanned: 0,
        }),
      );

      if (batchInvoicesPayload.length) {
        await ExpeditionBatchInvoice.bulkCreate(batchInvoicesPayload, {
          transaction: t,
        });
      }

      if (batchItemsPayload.length) {
        await ExpeditionBatchItems.bulkCreate(batchItemsPayload, {
          transaction: t,
        });
      }

      await Invoice.update(
        { batch_generated: true },
        { where: { id: notBatched.map((i) => i.id) }, transaction: t },
      );

      await batch.update({ total_volumes: totalVolumes }, { transaction: t });

      return (await ExpeditionBatch.findByPk(batch.id, {
        include: [
          {
            model: ExpeditionBatchItems,
            as: "items",
            separate: true,
            include: [
              {
                model: Product,
                as: "product",
                include: [{ model: Stock, as: "stocks" }],
              },
            ],
          },
          {
            model: ExpeditionBatchInvoice,
            as: "batchInvoices",
            separate: true,
            include: [
              {
                model: Invoice,
                as: "invoice",
                attributes: ["number_system"],
              },
            ],
          },
        ],
        transaction: t,
      })) as ExpeditionBatch;
    });
  }

  async getBatchesByInvoiceIds(
    invoiceIds: string[],
  ): Promise<ExpeditionBatch[]> {
    if (!invoiceIds.length) return [];

    // Busca os registros de vínculo invoice → batch
    const batchInvoices = await ExpeditionBatchInvoice.findAll({
      where: { invoice_id: invoiceIds },
    });

    const notFoundNotes = await Invoice.findAll({
      where: { id: invoiceIds },
      attributes: ["number_system"],
    });

    if (!batchInvoices.length) {
      throw new Error(
        `Nenhum lote encontrado para as notas: ${notFoundNotes.join(", ")}`,
      );
    }

    // Deduplica os IDs de lote — N notas podem pertencer ao mesmo lote
    const batchIds = [
      ...new Set(batchInvoices.map((bi) => bi.expedition_batch_id)),
    ];

    const batches = await ExpeditionBatch.findAll({
      where: { id: batchIds },
      include: [
        {
          model: ExpeditionBatchItems,
          as: "items",
          separate: true,
          include: [
            {
              model: Product,
              as: "product",
              include: [{ model: Stock, as: "stocks" }],
            },
          ],
        },
        {
          model: ExpeditionBatchInvoice,
          as: "batchInvoices",
          separate: true,
          include: [
            {
              model: Invoice,
              as: "invoice",
              attributes: ["number_system"],
            },
          ],
        },
      ],
    });

    return batches;
  }

  async findByIdFullBatch(batchId?: string, number?: string): Promise<ExpeditionBatchFull> {
    const fullBatch = await this.repository.getFullBatch(batchId ?? '', number ?? '')
    if (!fullBatch) throw new Error("Lote não encontrado");

    const batchWithTotalVolumes = fullBatch.batchInvoices!.map((s) => {
      const invoiceVolume = s.invoice.items.reduce(
        (acc: number, item: InvoiceItemsAttributes) => {
          acc += item.quantity_expected;

          return acc;
        },
        0,
      );

      return {
        ...s,
        ...s.invoice,
        invoiceVolume,
      };
    });

    const enrichedData = {
      ...fullBatch,
      batchWithTotalVolumes
    }

  
    return enrichedData;
  }
}

export default new ExpeditionBatchService();
