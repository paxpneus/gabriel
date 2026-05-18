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
import { extractChaveFromXml } from "../../../../shared/utils/xml/xml-parser";
import {
  decryptXml,
  isEncrypted,
} from "../../../../shared/utils/xml/xml-cipher";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../shared/query/query.types";
import { FindOptions } from "sequelize";
import UnitBusiness from "../../unit-business/unit-business.model";
import { setBatchNumber } from "../../../../shared/utils/normalizers/batch-nomenclature";
import invoiceService from "../../entrance/invoice/invoice.service";
import invoiceItemsService from "../../entrance/invoice-items/invoice-items.service";
import { ensureSameBy } from "../../../../shared/utils/validators/same-not-allowed";

export class ExpeditionBatchService extends BaseService<
  ExpeditionBatch,
  ExpeditionBatchRepository
> {
  constructor() {
    super(expeditionBatchRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
      searchFields: ["number"],
      filterableFields: [
        "status",
        "type",
        "integrations_id",
        "unit_business_id",
      ],
      sortableFields: ["number", "createdAt", "updatedAt"],
    };
  }

  async generateBatchFromInvoices(
    invoiceIds: string[],
    unitBusinessId: string,
    type: string,
  ): Promise<ExpeditionBatch> {
    let batchId: string;

    await sequelize.transaction(async (t) => {
      const invoices = await Invoice.findAll({
        where: { id: invoiceIds },
        include: [{ model: InvoiceItems, as: "items", required: true }],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      ensureSameBy(
        invoices,
        (i) => i.transporter_name,
        "Não é permitido adicionar notas com transportadoras diferentes ao lote!",
      );

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

        return (await this.repository.getFullBatch(
          batchInvoice.expedition_batch_id,
        )) as ExpeditionBatch;
      }

      const batchNumber = `LOTE-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase()}`;

      const batchType = type == "OUTGOING" ? "EXPEDITION" : "ENTRANCE";
      const unitBusiness = await UnitBusiness.findOne({
        where: {
          id: unitBusinessId,
        },
      });

      const batch = await ExpeditionBatch.create(
        {
          number: await setBatchNumber(
            batchType,
            unitBusiness?.number!,
            unitBusinessId,
          ),
          status: "OPEN",
          unit_business_id: unitBusinessId,
          total_volumes: 0,
          total_volumes_received: 0,
          integrations_id: invoices[0].integrations_id,
          type: type,
          transporters_id: invoices[0].transporter_id || null,
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

      batchId = batch.id;
    });
    return (await this.repository.getFullBatch(batchId!)) as ExpeditionBatch;
  }

  async addInvoiceToBatch(
    chaveAcesso: string,
    unitBusinessId: string,
    type: string,
    batchId?: string,
  ): Promise<ExpeditionBatch> {
    let resultBatchId: string;

    await sequelize.transaction(async (t) => {
      const invoice = await Invoice.findOne({
        where: { xml_key: chaveAcesso.replace(/\s/g, "") },
        include: [{ model: InvoiceItems, as: "items", required: true }],
        transaction: t,
      });

      if (!invoice)
        throw new Error("Nota não encontrada para a chave de acesso informada");
      if (!(invoice as any).items?.length)
        throw new Error("Nota não possui itens");

      const alreadyInBatch = await ExpeditionBatchInvoice.findOne({
        where: { invoice_id: invoice.id },

        transaction: t,
      });

      if (alreadyInBatch) {
        if (alreadyInBatch.expedition_batch_id === batchId) {
          resultBatchId = batchId!;
          return;
        }
        throw new Error(
          `Nota ${invoice.number_system} já pertence a outro lote`,
        );
      }

      let batch: ExpeditionBatchFull;

      if (batchId) {
        const found = await this.findByIdFullBatch(batchId, "", {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!found) throw new Error("Lote não encontrado");
        if (found.status === "FINISHED") throw new Error("Lote já finalizado");
        batch = found;

        ensureSameBy(
          [...(found.batchInvoices ?? []), { invoice }],
          (item) => item.invoice.transporter_name,
          "Não é permitido adicionar notas com transportadoras diferentes ao lote!",
        );
      } else {
        const unitBusiness = await UnitBusiness.findOne({
          where: {
            id: unitBusinessId,
          },
        });

        batch = await ExpeditionBatch.create(
          {
            number: await setBatchNumber(
              "ENTRANCE",
              unitBusiness?.number!,
              unitBusinessId,
            ),
            status: "OPEN",
            unit_business_id: unitBusinessId,
            total_volumes: 0,
            total_volumes_received: 0,
            integrations_id: invoice.integrations_id,
            type,
            transporters_id: invoice.transporter_id || null,
          },
          { transaction: t },
        );
      }

      await ExpeditionBatchInvoice.create(
        { expedition_batch_id: batch.id, invoice_id: invoice.id },
        { transaction: t },
      );

      const items = (invoice as any).items ?? [];

      for (const item of items) {
        const existing = await ExpeditionBatchItems.findOne({
          where: { expedition_batch_id: batch.id, product_id: item.product_id },
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        if (existing) {
          await existing.increment("quantity", {
            by: item.quantity_expected,
            transaction: t,
          });
        } else {
          await ExpeditionBatchItems.create(
            {
              expedition_batch_id: batch.id,
              product_id: item.product_id,
              quantity: item.quantity_expected,
              quantity_scanned: 0,
            },
            { transaction: t },
          );
        }
      }

      const addedVolumes = items.reduce(
        (acc: number, i: any) => acc + i.quantity_expected,
        0,
      );

      await ExpeditionBatch.increment("total_volumes", {
        by: addedVolumes,
        where: {
          id: batch.id,
        },
        transaction: t,
      });

      await Invoice.update(
        {
          batch_generated: true,
          status: "OPEN",
          received_at: new Date().toLocaleDateString("en-CA"),
        },
        { where: { id: invoice.id }, transaction: t },
      );

      resultBatchId = batch.id;
    });

    return (await this.repository.getFullBatch(
      resultBatchId!,
    )) as ExpeditionBatch;
  }

  async addInvoicesToBatch(
    chavesAcesso: string[],
    unitBusinessId: string,
    type: string,
    batchId?: string,
  ): Promise<ExpeditionBatch> {
    let resultBatchId: string;

    await sequelize.transaction(async (t) => {
      let batch: ExpeditionBatch;

      // ── Resolve ou cria o lote uma única vez ──────────────────────
      if (batchId) {
        const found = await ExpeditionBatch.findByPk(batchId, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });
        if (!found) throw new Error("Lote não encontrado");
        if (found.status === "FINISHED") throw new Error("Lote já finalizado");
        batch = found;
      } else {
        const unitBusiness = await UnitBusiness.findOne({
          where: { id: unitBusinessId },
        });

        batch = await ExpeditionBatch.create(
          {
            number: await setBatchNumber(
              "ENTRANCE",
              unitBusiness?.number!,
              unitBusinessId,
            ),
            status: "OPEN",
            unit_business_id: unitBusinessId,
            total_volumes: 0,
            total_volumes_received: 0,
            type,
          },
          { transaction: t },
        );
      }

      // ── Processa cada chave ───────────────────────────────────────
      let totalVolumesAdded = 0;
      const allInvoices = [];

      for (const chaveAcesso of chavesAcesso) {
        const invoice = await Invoice.findOne({
          where: { xml_key: chaveAcesso.replace(/\s/g, "") },
          include: [{ model: InvoiceItems, as: "items", required: true }],
          transaction: t,
        });
        allInvoices.push(invoice);

        if (!invoice)
          throw new Error(`Nota não encontrada para a chave: ${chaveAcesso}`);
        if (!(invoice as any).items?.length)
          throw new Error(`Nota ${chaveAcesso} não possui itens`);

        const alreadyInBatch = await ExpeditionBatchInvoice.findOne({
          where: { invoice_id: invoice.id },
          transaction: t,
        });

        if (alreadyInBatch) {
          // Já está neste mesmo lote — ignora silenciosamente
          if (alreadyInBatch.expedition_batch_id === batch.id) continue;
          throw new Error(
            `Nota ${invoice.number_system} já pertence a outro lote`,
          );
        }

        await ExpeditionBatchInvoice.create(
          { expedition_batch_id: batch.id, invoice_id: invoice.id },
          { transaction: t },
        );

        const items = (invoice as any).items ?? [];

        for (const item of items) {
          const existing = await ExpeditionBatchItems.findOne({
            where: {
              expedition_batch_id: batch.id,
              product_id: item.product_id,
            },
            transaction: t,
            lock: t.LOCK.UPDATE,
          });

          if (existing) {
            await existing.increment("quantity", {
              by: item.quantity_expected,
              transaction: t,
            });
          } else {
            await ExpeditionBatchItems.create(
              {
                expedition_batch_id: batch.id,
                product_id: item.product_id,
                quantity: item.quantity_expected,
                quantity_scanned: 0,
              },
              { transaction: t },
            );
          }
        }

        totalVolumesAdded += items.reduce(
          (acc: number, i: any) => acc + i.quantity_expected,
          0,
        );

        await Invoice.update(
          {
            batch_generated: true,
            status: "OPEN",
            received_at: new Date().toLocaleDateString("en-CA"),
          },
          { where: { id: invoice.id }, transaction: t },
        );

        // Seta o transporter/integrations do lote na primeira nota (se ainda não tem)
        if (!batch.transporters_id && invoice.transporter_id) {
          await batch.update(
            {
              transporters_id: invoice.transporter_id,
              integrations_id: invoice.integrations_id,
            },
            { transaction: t },
          );
        }
      }

      ensureSameBy(
        allInvoices,
        (i) => i!.transporter_name,
        "Não é permitido adicionar notas com transportadoras diferentes ao lote!",
      );

      if (totalVolumesAdded > 0) {
        await batch.increment("total_volumes", {
          by: totalVolumesAdded,
          transaction: t,
        });
      }

      resultBatchId = batch.id;
    });

    return (await this.repository.getFullBatch(
      resultBatchId!,
    )) as ExpeditionBatch;
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

  async getBatches(batchesIds: string[]): Promise<ExpeditionBatch[]> {
    if (!batchesIds.length) return [];

    const batches = await ExpeditionBatch.findAll({
      where: { id: batchesIds },
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

  async findByIdFullBatch(
    batchId?: string,
    number?: string,
    options?: FindOptions,
  ): Promise<ExpeditionBatchFull> {
    const fullBatch = await this.repository.getFullBatch(
      batchId ?? "",
      number ?? "",
      options,
    );
    if (!fullBatch) throw new Error("Lote não encontrado");

    const batchWithTotalVolumes = fullBatch.batchInvoices!.map((s) => {
      const invoiceVolume = s.invoice.items.reduce(
        (acc: number, item: InvoiceItemsAttributes) => {
          acc += item.quantity_expected;

          return acc;
        },
        0,
      );

      let chaveAcesso = "";

      const rawXml = s.invoice.xml_path ?? "";
      const xml = isEncrypted(rawXml) ? decryptXml(rawXml) : rawXml;
      chaveAcesso = extractChaveFromXml(xml);
      const { xml_path, ...invoiceSemXml } = s.invoice as any;

      return {
        ...s,
        invoice: {
          ...s.invoice,
          key: chaveAcesso.replace(/\s/g, ""),
          invoiceVolume,
        },
      };
    });

    const enrichedData = {
      ...fullBatch,
      batchWithTotalVolumes,
    };

    return enrichedData;
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<ExpeditionBatch>> {
    return super.paginate(params, {
      ...extraOptions,
      include: [
        {
          model: UnitBusiness,
          as: "unitBusiness",
        },
      ],
    });
  }

  async finishBatch(batchId: string, justification: string) {
    await sequelize.transaction(async (t) => {
      const fullBatch = await this.findByIdFullBatch(batchId);

      const invoicesIds = fullBatch.batchInvoices!.map((s) => s.invoice_id);

      const invoiceItemsIds = fullBatch.batchInvoices!.flatMap((s) =>
        s.invoice.items.map((i) => i.id),
      );

      await Promise.all([
        ExpeditionBatch.update(
          { status: "FINISHED", justification },
          { where: { id: batchId }, transaction: t },
        ),
        invoiceService.bulkUpdate(
          { status: "FINISHED" },
          { where: { id: invoicesIds }, transaction: t },
        ),
        invoiceItemsService.bulkUpdate(
          { status: "FINISHED" },
          { where: { id: invoiceItemsIds }, transaction: t },
        ),
      ]);
    });

    return this.findByIdFullBatch(batchId);
  }
}

export default new ExpeditionBatchService();
