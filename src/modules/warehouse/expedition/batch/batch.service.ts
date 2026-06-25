import {
  TCarConferenciaUnitBusiness,
  TCarConferenciaPostService,
} from "./../../../handlers/tecinco/service/conferencias-estoque/conferencia-estoque-post.service";
import BaseService from "../../../../shared/utils/base-models/base-service";
import ExpeditionBatch from "./batch.model";
import expeditionBatchRepository, {
  ExpeditionBatchRepository,
} from "./batch.repository";
import ExpeditionBatchInvoice from "../batch-invoices/batch-invoices.model";
import ExpeditionBatchItems from "../batch-items/batch-items.model";
import InvoiceItems from "../../invoices/invoice-items/invoice-items.model";
import Invoice from "../../invoices/invoice/invoice.model";
import sequelize from "../../../../config/sequelize";
import { Product, Stock } from "../../../inventory";
import ExpeditionScanLog from "../scan-logs/scan-logs.model";
import { ExpeditionBatchFull } from "./batch.types";
import { InvoiceItemsAttributes } from "../../invoices/invoice-items/invoice-items.types";
import { extractChaveFromXml } from "../../../../shared/utils/xml/xml-parser";
import {
  decryptXml,
  isEncrypted,
} from "../../../../shared/utils/xml/xml-cipher";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../shared/query/query.types";
import { FindOptions, Op } from "sequelize";
import UnitBusiness from "../../unit-business/unit-business.model";
import { setBatchNumber } from "../../../../shared/utils/normalizers/batch-nomenclature";
import invoiceService from "../../invoices/invoice/invoice.service";
import invoiceItemsService from "../../invoices/invoice-items/invoice-items.service";
import { ensureSameBy } from "../../../../shared/utils/validators/same-not-allowed";
import transporterService from "../../transporter/transporter.service";
import Transporter from "../../transporter/transporter.model";
import integrationsService from "../../../integrations/integrations/integrations.service";

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
        "transporters_id",
      ],
      sortableFields: ["number", "createdAt", "updatedAt"],
      customFields: {
        delivery_note_generated: (value) => {
          if (value === "true") {
            return { delivery_note_generated_at: { [Op.not]: null } };
          }
          if (value === "false") {
            return { delivery_note_generated_at: { [Op.is]: null } };
          }
          return {};
        },
      },
    };
  }

  async isComplete(id: string): Promise<boolean> {
    const batch: ExpeditionBatch | null = await this.findById(id);
    if (!batch) {
      throw new Error("Lote não encontrado!");
    }

    if (batch.total_volumes_received >= batch.total_volumes) {
      return true;
    }

    return false;
  }

  // ── Garante que a nota pertença à unidade de negócio, salvo se transbordo for permitido ──
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

  async generateBatchFromInvoices(
    invoiceIds: string[],
    unitBusinessId: string,
    type: string,
    mode?: string,
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
        mode,
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

      const unitBusiness = await UnitBusiness.findOne({
        where: {
          id: unitBusinessId,
        },
        transaction: t,
      });

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

      for (const invoice of notBatched) {
        this.assertTransshipment(invoice, unitBusiness);
      }

      const batchNumber = `LOTE-${Date.now()}-${Math.random()
        .toString(36)
        .substring(2, 6)
        .toUpperCase()}`;

      const batchType = type == "OUTGOING" ? "EXPEDITION" : "ENTRANCE";

      let transporter;
      if (invoices[0].transporter_id) {
        transporter = await transporterService.findById(
          invoices[0].transporter_id,
        );
      }

      const batch = await ExpeditionBatch.create(
        {
          number: await setBatchNumber(
            batchType,
            unitBusiness?.number!,
            unitBusinessId,
            transporter?.name ?? invoices[0].transporter_name ?? null,
            t,
          ),
          status: "OPEN",
          unit_business_id: unitBusinessId,
          total_volumes: 0,
          total_volumes_received: 0,
          integrations_id: invoices[0].integrations_id,
          type: type,
          mode,
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
        include: [{ model: InvoiceItems, as: "items", required: false }],
        transaction: t,
      });

      if (!invoice)
        throw new Error("Nota não encontrada para a chave de acesso informada");
      if (!(invoice as any).items?.length)
        throw new Error("Nota não possui itens");

      const unitBusiness = await UnitBusiness.findOne({
        where: {
          id: unitBusinessId,
        },
        transaction: t,
      });

      this.assertTransshipment(invoice, unitBusiness);

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
        await ExpeditionBatch.findByPk(batchId, {
          transaction: t,
          lock: t.LOCK.UPDATE,
        });

        const found = await this.findByIdFullBatch(batchId, "", {
          transaction: t,
        });
        if (!found) throw new Error("Lote não encontrado");
        if (found.status === "FINISHED") throw new Error("Lote já finalizado");
        batch = found;

        if (
          batch.mode === "REGULAR" &&
          batch.transporters_id &&
          invoice.transporter_id &&
          batch.transporters_id !== invoice.transporter_id
        ) {
          throw new Error(
            "Não é permitido adicionar notas com transportadoras diferentes ao lote!",
          );
        }
      } else {
        let transporter;

        if (invoice.transporter_id) {
          transporter = await transporterService.findById(
            invoice.transporter_id,
          );
        }

        batch = await ExpeditionBatch.create(
          {
            number: await setBatchNumber(
              "ENTRANCE",
              unitBusiness?.number!,
              unitBusinessId,
              transporter?.name ?? invoice.transporter_name ?? null,
              t,
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

      const unitBusiness = await UnitBusiness.findOne({
        where: { id: unitBusinessId },
        transaction: t,
      });

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
        let transporter;

        const firstInvoice = await Invoice.findOne({
          where: {
            xml_key: chavesAcesso[0],
          },
          transaction: t,
        });

        if (firstInvoice?.transporter_id) {
          transporter = await transporterService.findById(
            firstInvoice.transporter_id,
          );
        }

        batch = await ExpeditionBatch.create(
          {
            number: await setBatchNumber(
              "ENTRANCE",
              unitBusiness?.number!,
              unitBusinessId,
              transporter?.name ?? firstInvoice?.transporter_name ?? null,
              t,
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

        this.assertTransshipment(invoice, unitBusiness);

        if (
          batch.mode === "REGULAR" &&
          batch.transporters_id &&
          invoice.transporter_id &&
          batch.transporters_id !== invoice.transporter_id
        ) {
          throw new Error(
            "Não é permitido adicionar notas com transportadoras diferentes ao lote!",
          );
        }

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
    return this.enrichBatch(fullBatch);
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
        {
          model: Transporter,
          as: "transporter",
        },
      ],
    });
  }

  async finishBatch(batchId: string, justification: string, user: any) {
    const fullBatch = await this.finishBatchTransaction(batchId, justification);

    await this.postTecincoConferencia(fullBatch, batchId, user).catch((err) =>
      console.error(
        `[finishBatch] Erro ao postar conferência Tecinco | batch=${batchId}`,
        err,
      ),
    );

    return this.findByIdFullBatch(batchId);
  }

  private async finishBatchTransaction(
    batchId: string,
    justification: string,
  ): Promise<ExpeditionBatchFull> {
    return sequelize.transaction(async (t) => {
      const fullBatch = await this.findByIdFullBatch(batchId);

      const invoicesIds = fullBatch.batchInvoices!.map((s) => s.invoice_id);
      const invoiceItemsIds = fullBatch.batchInvoices!.flatMap((s) =>
        s.invoice.items.map((i) => i.id),
      );

      await Promise.all([
        ExpeditionBatch.update(
          {
            status: "FINISHED",
            justification,
            finished_at: sequelize.literal(
              "COALESCE(finished_at, NOW())",
            ) as unknown as Date,
          },
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

      return fullBatch;
    });
  }

  private async postTecincoConferencia(
    fullBatch: ExpeditionBatchFull,
    batchId: string,
    user: any,
  ) {
    const { integrations_id } = fullBatch;
    if (!integrations_id) return;

    const integration = await integrationsService.findById(integrations_id);
    if (integration?.name !== "Tecinco") return;

    const branchId = parseInt(user.unitBusiness.number, 10);
    const unitBusiness: TCarConferenciaUnitBusiness = {
      id: user.unitBusiness.id,
      cnpj: user.unitBusiness.cnpj,
      number: user.unitBusiness.number,
    };

    await new TCarConferenciaPostService().postarConferenciaPorLote(
      batchId,
      unitBusiness,
      branchId,
      user.id_system,
    );
  }

  async generateDeliveryNote(batchId: string, userId: string) {
    const batchInfo = await this.findByIdFullBatch(batchId);
    let generated_at: Date;
    let operator_id: string;

    !batchInfo.delivery_note_generated_at
      ? (generated_at = new Date())
      : (generated_at = batchInfo.delivery_note_generated_at);

    !batchInfo.operator_id
      ? (operator_id = userId)
      : (operator_id = batchInfo.operator_id);

    console.log(userId, batchInfo.operator_id);

    await this.repository.update(batchId, {
      delivery_note_generated_at: generated_at,
      operator_id: operator_id,
    });

    const updatedBatch = await this.findByIdFullBatch(batchId);

    return updatedBatch;
  }

  async downloadDeliveryNotes(batchesId: string[]) {
    const batches = await this.repository.getFullBatches(batchesId);
    return batches.map((batch) => this.enrichBatch(batch));
  }

  private enrichBatch(fullBatch: ExpeditionBatchFull): ExpeditionBatchFull {
    const batchWithTotalVolumes = fullBatch.batchInvoices!.map((s) => {
      const invoiceVolume = s.invoice.items.reduce(
        (acc: number, item: InvoiceItemsAttributes) =>
          acc + item.quantity_expected,
        0,
      );

      const rawXml = s.invoice.xml_path ?? "";
      const xml = isEncrypted(rawXml) ? decryptXml(rawXml) : rawXml;
      const chaveAcesso = extractChaveFromXml(xml);
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

    return { ...fullBatch, batchWithTotalVolumes };
  }
}

export default new ExpeditionBatchService();
