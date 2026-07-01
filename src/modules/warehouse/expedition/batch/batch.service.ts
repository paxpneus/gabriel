import { TCarConferenciaPostService } from "./../../../handlers/tecinco/service/conferencias-estoque/conferencia-estoque-post.service";
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
import { FindOptions, Op, Transaction } from "sequelize";
import UnitBusiness from "../../unit-business/unit-business.model";
import { setBatchNumber } from "../../../../shared/utils/normalizers/batch-nomenclature";
import invoiceService from "../../invoices/invoice/invoice.service";
import invoiceItemsService from "../../invoices/invoice-items/invoice-items.service";
import { ensureSameBy } from "../../../../shared/utils/validators/same-not-allowed";
import transporterService from "../../transporter/transporter.service";
import Transporter from "../../transporter/transporter.model";
import integrationsService from "../../../integrations/integrations/integrations.service";
import { assertTransshipment } from "../utils/helpers/transshipment-resolver";
import batchInvoicesService from "../batch-invoices/batch-invoices.service";
import batchItemsService from "../batch-items/batch-items.service";
import batchInvoiceItemsService from "../batch-invoice-items/batch-invoice-items.service";
import InvoiceUnitBusinessAttributes from "../../invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import unitBusinessService from "../../unit-business/unit-business.service";
import { FullInvoice } from "../../invoices/invoice/invoice.types";

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

  /**
   * Função centralizada de CRIAÇÃO de estrutura de lote.
   *
   * Dentro da transação fornecida pelo chamador:
   *  1. Cria o ExpeditionBatch;
   *  2. Cria o ExpeditionBatchInvoice para cada nota;
   *  3. Cria/incrementa o ExpeditionBatchItems agregado por produto;
   *  4. Cria/incrementa o BatchInvoiceItems (quantity_expected daquela nota
   *     p/ aquele item — protegido pelo unique constraint do par
   *     batch_invoice + batch_item);
   *  5. Atualiza total_volumes do batch com a soma de tudo.
   *
   * Não acessa nenhum Model diretamente — só services (this, batchItemsService,
   * batchInvoicesService, batchInvoiceItemsService).
   *
   * Para adicionar notas a um lote JÁ EXISTENTE, use outra função (a ser feita
   * na parte 2).
   */
  async createBatchStructure(
    batchData: Record<string, any>,
    invoices: (Invoice & { items?: InvoiceItemsAttributes[] })[],
    t: Transaction,
  ): Promise<{
    batch: ExpeditionBatch;
    batchInvoices: ExpeditionBatchInvoice[];
    totalVolumesAdded: number;
  }> {
    const batch = await this.create(batchData, { transaction: t });

    // Uma única chamada para todas as invoices — sem loop
    const { batchInvoices, volumesAdded: totalVolumesAdded } =
      await batchInvoicesService.createBatchInvoiceWithItems(
        batch.id,
        invoices,
        t,
      );

    if (totalVolumesAdded > 0) {
      await this.increment("total_volumes", {
        by: totalVolumesAdded,
        where: { id: batch.id },
        transaction: t,
      });
    }

    return { batch, batchInvoices, totalVolumesAdded };
  }

  async generateBatchFromInvoices(
    invoiceIds: string[],
    unitBusinessId: string,
    type: string,
    mode?: string,
  ): Promise<ExpeditionBatch> {
    let batchId: string;

    await sequelize.transaction(async (t) => {
      const lockedInvoices = await invoiceService.findAll({
        where: { id: invoiceIds },
        attributes: ["id"],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      // 2. Busca completa sem lock
      const rawInvoices = await invoiceService.findAll({
        where: { id: invoiceIds },
        include: [
          { model: InvoiceItems, as: "items", required: true },
          {
            model: InvoiceUnitBusinessAttributes,
            as: "unitBusinessAttributes",
            where: { unit_business_id: unitBusinessId },
            required: false,
          },
        ],
        transaction: t,
      });

      const invoices: FullInvoice[] = rawInvoices.map((invoice) => {
        const plain = invoice.get({ plain: true });
        return {
          ...plain,
          unitBusinessAttributes: plain.unitBusinessAttributes?.[0] ?? null,
        } as unknown as FullInvoice;
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

      const unitBusiness = await unitBusinessService.findOne({
        where: { id: unitBusinessId },
        transaction: t,
      });

      // ── batch_generated agora vem do attributes, não mais da coluna em Invoice ──
      const getAttr = (invoice: FullInvoice) => invoice.unitBusinessAttributes;

      const alreadyBatched = invoices.filter(
        (i) => getAttr(i)?.batch_generated,
      );
      const notBatched = invoices.filter((i) => !getAttr(i)?.batch_generated);

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
        const batchInvoice = await batchInvoicesService.findOne({
          where: { invoice_id: invoices[0].id },
          transaction: t,
        });

        if (!batchInvoice) {
          throw new Error("Lote não encontrado para notas já processadas");
        }

        batchId = batchInvoice.expedition_batch_id;
        return;
      }

      for (const invoice of notBatched) {
        assertTransshipment(invoice, unitBusiness);
      }

      const batchType = type == "OUTGOING" ? "EXPEDITION" : "ENTRANCE";

      let transporter;
      if (invoices[0].transporter_id) {
        transporter = await transporterService.findById(
          invoices[0].transporter_id,
        );
      }

      const batchData = {
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
        type,
        mode,
        transporters_id: invoices[0].transporter_id || null,
      };

      const { batch } = await this.createBatchStructure(
        batchData,
        notBatched as any,
        t,
      );

      await invoiceService.updateInvoices(
        notBatched.map((i) => i.id),
        unitBusinessId,
        { batch_generated: true, status: "PENDING" },
      );

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
      const invoice = await invoiceService.findOne({
        where: { xml_key: chaveAcesso.replace(/\s/g, "") },
        include: [{ model: InvoiceItems, as: "items", required: false }],
        transaction: t,
      });

      if (!invoice)
        throw new Error("Nota não encontrada para a chave de acesso informada");
      if (!(invoice as any).items?.length)
        throw new Error("Nota não possui itens");

      const plainInvoice = invoice.get({ plain: true }) as any;

      const unitBusiness = await unitBusinessService.findOne({
        where: { id: unitBusinessId },
        transaction: t,
      });

      assertTransshipment(invoice, unitBusiness);

      // ── Verifica se já existe um batch_invoice para essa nota NESSA unit_business ──
      const alreadyInBatch = await batchInvoicesService.findOne({
        where: { invoice_id: invoice.id },
        include: [
          {
            model: ExpeditionBatch,
            as: "batch",
            where: { unit_business_id: unitBusinessId },
            required: true,
          },
        ],
        transaction: t,
      });

      if (alreadyInBatch) {
        if (alreadyInBatch.expedition_batch_id === batchId) {
          resultBatchId = batchId!;
          return;
        }
        throw new Error(
          `Nota ${invoice.number_system} já pertence a outro lote nesta unidade`,
        );
      }

      if (batchId) {
        // ── Lote já existe: trava e valida ──────────────────────────────────
        await this.findById(batchId, { transaction: t, lock: t.LOCK.UPDATE });

        const found = await this.findByIdFullBatch(batchId, "", {
          transaction: t,
        });
        if (!found) throw new Error("Lote não encontrado");
        if (found.status === "FINISHED") throw new Error("Lote já finalizado");

        if (
          found.mode === "REGULAR" &&
          found.transporters_id &&
          invoice.transporter_id &&
          found.transporters_id !== invoice.transporter_id
        ) {
          throw new Error(
            "Não é permitido adicionar notas com transportadoras diferentes ao lote!",
          );
        }

        const { volumesAdded } =
          await batchInvoicesService.createBatchInvoiceWithItems(
            batchId,
            [plainInvoice] as any,
            t,
          );

        await this.increment("total_volumes", {
          by: volumesAdded,
          where: { id: batchId },
          transaction: t,
        });

        resultBatchId = batchId;
      } else {
        // ── Lote não existe: cria do zero via createBatchStructure ─────────
        let transporter;

        if (invoice.transporter_id) {
          transporter = await transporterService.findById(
            invoice.transporter_id,
          );
        }

        const batchData = {
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
        };

        const { batch } = await this.createBatchStructure(
          batchData,
          [plainInvoice as any],
          t,
        );

        resultBatchId = batch.id;
      }

      await invoiceService.updateInvoices([invoice.id], unitBusinessId, {
        batch_generated: true,
        status: "OPEN",
        received_at: new Date().toLocaleDateString("en-CA"),
      });
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

  async getBatches(batchesIds: string[]): Promise<ExpeditionBatchFull[]> {
    if (!batchesIds.length) return [];

    const batches = await this.repository.getFullBatches(batchesIds);

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
    return fullBatch;
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
    const fullBatch = await sequelize.transaction(async (t) => {
      const batch = await this.finishBatchTransaction(
        batchId,
        justification,
        t,
      );

      try {
        await this.postTecincoConferencia(batch, batchId, user);
      } catch (err: any) {
        console.error(
          `[finishBatch] Erro ao postar conferência Tecinco | batch=${batchId}`,
          err,
        );
        throw new Error(
          "Erro ao sincronizar com a Tecinco. O lote não foi finalizado.",
        );
      }

      return batch;
    });

    return this.findByIdFullBatch(batchId);
  }

  private async finishBatchTransaction(
    batchId: string,
    justification: string,
    t: Transaction,
  ): Promise<ExpeditionBatchFull> {
    const fullBatch = await this.findByIdFullBatch(batchId);

    if (!fullBatch.batchInvoices?.length) {
      throw new Error("Não é possível finalizar um lote sem notas");
    }

    if (!fullBatch.batchInvoices.some((s) => s.items?.length)) {
      throw new Error("Não é possível finalizar um lote sem itens");
    }

    const invoicesIds = fullBatch.batchInvoices!.map((s) => s.invoice_id);

    const batchInvoiceItemsIds = fullBatch.batchInvoices!.flatMap((s) =>
      s.items!.map((i) => i.id),
    );

    await Promise.all([
      this.bulkUpdate(
        {
          status: "FINISHED",
          justification,
          finished_at: sequelize.literal(
            "COALESCE(finished_at, NOW())",
          ) as unknown as Date,
        },
        { where: { id: batchId }, transaction: t },
      ),
      invoiceService.updateInvoices(
        invoicesIds,
        fullBatch.unit_business_id,
        { status: "FINISHED" },
        undefined,
        t,
      ),
      batchInvoiceItemsService.bulkUpdate(
        { status: "FINISHED" },
        { where: { id: batchInvoiceItemsIds }, transaction: t },
      ),
    ]);

    return fullBatch;
  }

  private async postTecincoConferencia(
    fullBatch: ExpeditionBatchFull,
    batchId: string,
    user: any,
  ) {
    console.log(
      `[postTecincoConferencia] user.unitBusiness=`,
      user?.unitBusiness,
    );
    const branchId = parseInt(user.unitBusiness.number, 10);

    await new TCarConferenciaPostService().postarConferenciaPorLote(
      batchId,
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

    await this.repository.update(batchId, {
      delivery_note_generated_at: generated_at,
      operator_id: operator_id,
    });

    const updatedBatch = await this.findByIdFullBatch(batchId);

    return updatedBatch;
  }

  async downloadDeliveryNotes(batchesId: string[]) {
    const batches = await this.repository.getFullBatches(batchesId);
    return batches;
  }
}

export default new ExpeditionBatchService();
