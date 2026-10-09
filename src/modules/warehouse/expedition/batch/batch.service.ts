import { TCarConferenciaPostService } from "./../../../handlers/tecinco/service/conferencias-estoque/conferencia-estoque-post.service";
import BaseService from "../../../../shared/utils/base-models/base-service";
import ExpeditionBatch from "./batch.model";
import expeditionBatchRepository, {
  ExpeditionBatchRepository,
} from "./batch.repository";
import ExpeditionBatchInvoice from "../batch-invoices/batch-invoices.model";
import ExpeditionBatchItems from "../batch-items/batch-items.model";
import InvoiceItems from "../../fiscal/invoices/invoice-items/invoice-items.model";
import Invoice from "../../fiscal/invoices/invoice/invoice.model";
import sequelize from "../../../../config/sequelize";
import { Product, Stock } from "../../../inventory";
import ExpeditionScanLog from "../scan-logs/scan-logs.model";
import {
  ExpeditionBatchFull,
  PdvBatchActionParams,
  PdvBatchActionResult,
  PdvBatchSkipped,
  PdvBatchSkipReason,
} from "./batch.types";
import { InvoiceItemsAttributes } from "../../fiscal/invoices/invoice-items/invoice-items.types";
import { extractChaveFromXml } from "../../../../shared/utils/xml/xml-parser";
import {
  decryptXml,
  isEncrypted,
} from "../../../../shared/utils/xml/xml-cipher";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../shared/query/query.types";
import { DestroyOptions, FindOptions, Op, Transaction } from "sequelize";
import UnitBusiness from "../../../company/unit-business/unit-business.model";
import { setBatchNumber } from "../../../../shared/utils/normalizers/batch-nomenclature";
import invoiceService from "../../fiscal/invoices/invoice/invoice.service";
import invoiceItemsService from "../../fiscal/invoices/invoice-items/invoice-items.service";
import { ensureSameBy } from "../../../../shared/utils/validators/same-not-allowed";
import transporterService from "../../transporter/transporter.service";
import Transporter from "../../transporter/transporter.model";
import integrationsService from "../../../integrations/integrations/integrations.service";
import { assertTransshipment } from "../utils/helpers/transshipment-resolver";
import batchInvoicesService from "../batch-invoices/batch-invoices.service";
import batchItemsService from "../batch-items/batch-items.service";
import batchInvoiceItemsService from "../batch-invoice-items/batch-invoice-items.service";
import InvoiceUnitBusinessAttributes from "../../fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import unitBusinessService from "../../../company/unit-business/unit-business.service";
import { FullInvoice } from "../../fiscal/invoices/invoice/invoice.types";
import unmappedInvoiceProductService from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
import scanLogsService from "../scan-logs/scan-logs.service";
import pdvSalesRequestService from "../../../sales/pdv-management/sales-request/pdv-sales-request.service";
import {
  assertAdtTransporterCd,
  describeTransporterSelector,
} from "../../../sales/pdv-management/sales-request/helpers/transporter-cd";
import {
  PdvBatchStage,
  PdvBatchTarget,
  PdvSalesRequestStatus,
  PdvTransporterSelector,
} from "../../../sales/pdv-management/sales-request/pdv-sales-request.types";
import { CD21_STATUS_LABELS } from "../../../sales/pdv-management/sales-request/helpers/next-action.rules";

// Complemento das mensagens de "nenhuma candidata" das ações de lote do PDV.
const PDV_BATCH_STAGE_LABELS: Record<PdvBatchStage, string> = {
  [PdvBatchStage.WITHOUT_BATCH]: "sem lote",
  [PdvBatchStage.IN_BATCH]: "em lote",
  [PdvBatchStage.OPEN_BATCH]: "em lote pendente",
  [PdvBatchStage.FINISHED_WITHOUT_DELIVERY_NOTE]: "com lote finalizado aguardando romaneio",
};

const PDV_BATCH_COLUMNS: readonly PdvSalesRequestStatus[] = [
  PdvSalesRequestStatus.SHIPPING,
  PdvSalesRequestStatus.SHIP_TODAY,
];

// defaultStage: o que a ação pega sem ids; selectedStage: o que as escolhidas precisam estar.
interface PdvBatchActionRule {
  defaultStage: PdvBatchStage;
  selectedStage: PdvBatchStage;
  groupByTransporter: boolean;
  selectedNotInStage: (orders: string, single: boolean) => string;
}

const PDV_SELECTED_ALREADY_IN_BATCH = (orders: string, single: boolean) =>
  single
    ? `A solicitação do pedido ${orders} já está em um lote.`
    : `Nem todas as solicitações estão sem lote. Já em lote: pedidos ${orders}.`;

const PDV_BATCH_ACTION_RULES = {
  generate: {
    defaultStage: PdvBatchStage.WITHOUT_BATCH,
    selectedStage: PdvBatchStage.WITHOUT_BATCH,
    groupByTransporter: true,
    selectedNotInStage: PDV_SELECTED_ALREADY_IN_BATCH,
  },
  add: {
    defaultStage: PdvBatchStage.WITHOUT_BATCH,
    selectedStage: PdvBatchStage.WITHOUT_BATCH,
    groupByTransporter: true,
    selectedNotInStage: PDV_SELECTED_ALREADY_IN_BATCH,
  },
  deliveryNote: {
    defaultStage: PdvBatchStage.FINISHED_WITHOUT_DELIVERY_NOTE,
    selectedStage: PdvBatchStage.IN_BATCH,
    groupByTransporter: false,
    selectedNotInStage: (orders: string, single: boolean) =>
      single
        ? `A solicitação do pedido ${orders} ainda não está em um lote.`
        : `Nem todas as solicitações estão em um lote. Sem lote: pedidos ${orders}.`,
  },
} satisfies Record<string, PdvBatchActionRule>;

// Solicitações de uma mesma transportadora (ou as escolhidas, sem transportadora) processadas juntas.
interface PdvBatchGroup {
  transporter: PdvTransporterSelector | null;
  transporterId: string | null;
  transporterName: string | null;
  salesRequestIds: string[];
  orderNumbers: string[];
  invoiceIds: string[];
}

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

      const unmappedRows =
        await unmappedInvoiceProductService.findUnmappedByInvoiceIds(
          notBatched.map((i) => i.id),
          t,
        );
      if (unmappedRows.length) {
        const numbers = [
          ...new Set(
            unmappedRows.map(
              (u: any) => u.invoice?.number_system ?? u.invoice_id,
            ),
          ),
        ];
        throw new Error(
          `Nota(s) com produtos não mapeados: ${numbers.join(", ")}`,
        );
      }

      for (const invoice of notBatched) {
        await assertTransshipment(invoice, unitBusiness);
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
  chavesAcesso: string[],
  unitBusinessId: string,
  type: string,
  batchId?: string,
  description?: string,
  externalTransaction?: Transaction,
): Promise<ExpeditionBatch> {
  let resultBatchId: string;

  const run = async (t: Transaction) => {
    if (!Array.isArray(chavesAcesso) || !chavesAcesso.length) {
    throw new Error("Nenhuma chave de acesso informada");
  }

  const cleanedChaves = [
    ...new Set(
      chavesAcesso
        .filter((c): c is string => typeof c === "string" && c.trim() !== "")
        .map((c) => c.replace(/\s/g, "")),
    ),
  ];

  if (!cleanedChaves.length) {
    throw new Error("Nenhuma chave de acesso válida informada");
  }

    const invoices = await invoiceService.findAll({
      where: { xml_key: cleanedChaves },
      include: [{ model: InvoiceItems, as: "items", required: false }],
      transaction: t,
    });

    if (!invoices.length) {
      throw new Error(
        "Nenhuma nota encontrada para as chaves de acesso informadas",
      );
    }

    if (invoices.length !== cleanedChaves.length) {
      const foundKeys = invoices.map((i: any) => i.xml_key);
      const missing = cleanedChaves.filter((c) => !foundKeys.includes(c));
      throw new Error(`Nota(s) não encontrada(s): ${missing.join(", ")}`);
    }

    const semItens = invoices.filter((i) => !(i as any).items?.length);
    if (semItens.length) {
      throw new Error(
        `As seguintes notas não possuem itens: ${semItens
          .map((i) => i.number_system)
          .join(", ")}`,
      );
    }

    const invoiceIds = invoices.map((i) => i.id);

    const invoiceUnmapped =
      await unmappedInvoiceProductService.findUnmappedByInvoiceIds(
        invoiceIds,
        t,
      );
    if (invoiceUnmapped.length) {
      const numbers = [
        ...new Set(
          invoiceUnmapped.map(
            (u: any) => u.invoice?.number_system ?? u.invoice_id,
          ),
        ),
      ];
      throw new Error(
        `Nota(s) com produtos não mapeados: ${numbers.join(", ")}`,
      );
    }

    const unitBusiness = await unitBusinessService.findOne({
      where: { id: unitBusinessId },
      transaction: t,
    });

    // ── Todas as notas do lote precisam ser da mesma transportadora ──
    ensureSameBy(
      invoices,
      (i: any) => i.transporter_name,
      "Não é permitido adicionar notas com transportadoras diferentes ao lote!",
    );

    for (const invoice of invoices) {
      await assertTransshipment(invoice, unitBusiness);
    }

    // ── Verifica se alguma dessas notas já está em algum batch_invoice NESSA unit_business ──
    const alreadyInBatch = await batchInvoicesService.findAll({
      where: { invoice_id: invoiceIds },
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

    if (alreadyInBatch.length) {
      const notInTargetBatch = alreadyInBatch.filter(
        (bi) => bi.expedition_batch_id !== batchId,
      );

      if (notInTargetBatch.length) {
        const conflictingIds = new Set(
          notInTargetBatch.map((bi) => bi.invoice_id),
        );
        const numbers = invoices
          .filter((i) => conflictingIds.has(i.id))
          .map((i) => i.number_system)
          .join(", ");
        throw new Error(
          `Nota(s) ${numbers} já pertence(m) a outro lote nesta unidade`,
        );
      }
    }

    // notas que já estão no lote-alvo não precisam ser reprocessadas
    const alreadyInTargetBatchIds = new Set(
      alreadyInBatch.map((bi) => bi.invoice_id),
    );
    const plainInvoices = invoices
      .filter((i) => !alreadyInTargetBatchIds.has(i.id))
      .map((i) => i.get({ plain: true })) as any[];

    if (!plainInvoices.length) {
      // todas as notas informadas já estavam no lote-alvo
      resultBatchId = batchId!;
      return;
    }

    if (batchId) {
      // ── Lote já existe: trava e valida ──────────────────────────────────
      await this.findById(batchId, { transaction: t, lock: t.LOCK.UPDATE });

      const found = await this.findByIdFullBatch(batchId, "", {
        transaction: t,
      });
      if (!found) throw new Error("Lote não encontrado");
      if (found.status === "FINISHED") throw new Error("Lote já finalizado");

      if (found.mode === "REGULAR" && found.transporters_id) {
        const conflicting = plainInvoices.find(
          (i) =>
            i.transporter_id && i.transporter_id !== found.transporters_id,
        );
        if (conflicting) {
          throw new Error(
            "Não é permitido adicionar notas com transportadoras diferentes ao lote!",
          );
        }
      }

      const { volumesAdded } =
        await batchInvoicesService.createBatchInvoiceWithItems(
          batchId,
          plainInvoices as any,
          t,
        );

      await this.increment("total_volumes", {
        by: volumesAdded,
        where: { id: batchId },
        transaction: t,
      });

      if (description) {
        await invoiceService.updateInvoices(
          plainInvoices.map((i) => i.id),
          unitBusinessId,
          { description },
          undefined,
          t,
        );
      }

      resultBatchId = batchId;
    } else {
      // ── Lote não existe: cria do zero via createBatchStructure ─────────
      const firstInvoice = plainInvoices[0];
      let transporter;

      if (firstInvoice.transporter_id) {
        transporter = await transporterService.findById(
          firstInvoice.transporter_id,
        );
      }

      const batchType = type == "OUTGOING" ? "EXPEDITION" : "ENTRANCE";

      const batchData = {
        number: await setBatchNumber(
          batchType,
          unitBusiness?.number!,
          unitBusinessId,
          transporter?.name ?? firstInvoice.transporter_name ?? null,
          t,
        ),
        status: "OPEN",
        unit_business_id: unitBusinessId,
        total_volumes: 0,
        total_volumes_received: 0,
        integrations_id: firstInvoice.integrations_id,
        type,
        transporters_id: firstInvoice.transporter_id || null,
      };

      const { batch } = await this.createBatchStructure(
        batchData,
        plainInvoices as any,
        t,
      );

      resultBatchId = batch.id;
    }

    await invoiceService.updateInvoices(
      plainInvoices.map((i) => i.id),
      unitBusinessId,
      {
        batch_generated: true,
        status: "PENDING",
        received_at: new Date().toLocaleDateString("en-CA"),
      },
      undefined,
      t,
    );
  };

  if (externalTransaction) {
    await run(externalTransaction);
    // mesma transação também na leitura final — senão lê antes do commit

    return this.repository.getFullBatch(resultBatchId!, "", {
      transaction: externalTransaction,
    }) as Promise<ExpeditionBatch>;
  }

  await sequelize.transaction(run);
  return (await this.repository.getFullBatch(
    resultBatchId!,
  )) as ExpeditionBatch;
}

/**
 * Adiciona uma ou mais notas ao último lote pendente
 * (last_outgoing_batch_pending) da unit_business. Se não houver lote
 * pendente ainda, addInvoiceToBatch cria um novo normalmente. Ao final,
 * atualiza o ponteiro pro lote resultante. Tudo numa única transação —
 * leitura do ponteiro, escrita no lote e atualização do ponteiro não podem
 * ficar inconsistentes entre si.
 */
async addInvoiceToLastOutgoingBatch(
  chavesAcesso: string[],
  unitBusinessId: string,
  type: string,
  description?: string,
): Promise<ExpeditionBatch> {
  return sequelize.transaction(async (t) => {
    const unitBusiness = await unitBusinessService.findById(unitBusinessId, {
      transaction: t,
    });
    if (!unitBusiness) throw new Error("Unit business não encontrada");

    const batch = await this.addInvoiceToBatch(
      chavesAcesso,
      unitBusinessId,
      type,
      unitBusiness.last_outgoing_batch_pending ?? undefined,
      description,
      t,
    );

    await unitBusinessService.update(
      unitBusinessId,
      { last_outgoing_batch_pending: batch.id },
      { transaction: t },
    );

    return batch;
  });
}

  // ─── Lote/romaneio do PDV (CD21) ─────────────────────────────────────────
  // 3 ações por coluna (status) — ver .claude/entities/expedition-batch/pdv-sales-request.md.

  async generateBatchFromPdv(
    params: PdvBatchActionParams,
  ): Promise<PdvBatchActionResult<ExpeditionBatch>> {
    const cd21 = await this.getCd21();
    const { groups, skipped } = await this.resolvePdvBatchGroups(
      params,
      PDV_BATCH_ACTION_RULES.generate,
    );

    const batches: ExpeditionBatch[] = [];
    // Sequencial: setBatchNumber numera pelo último lote do CD21 — em paralelo, dois lotes pegariam o mesmo número.
    for (const group of groups) {
      try {
        batches.push(
          await this.generateBatchFromInvoices(
            group.invoiceIds,
            cd21.id,
            "OUTGOING",
            "REGULAR",
          ),
        );
        await pdvSalesRequestService.notifyChangedBySaleInvoiceIds(group.invoiceIds);
      } catch (error: any) {
        skipped.push(this.pdvSkipped(PdvBatchSkipReason.FAILED, group, error.message));
      }
    }
    return this.pdvBatchActionResult(batches, skipped);
  }

  // Sem batchId: lote pendente mais recente de cada transportadora (nunca cria); só ids → último lote pendente do CD21 (cria se não houver).
  async addPdvToBatch(
    params: PdvBatchActionParams & { batchId?: string },
  ): Promise<PdvBatchActionResult<ExpeditionBatch>> {
    if (
      params.batchId &&
      !params.salesRequestIds?.length &&
      !this.hasPdvTransporter(params)
    ) {
      throw new Error(
        "Para escolher o lote, selecione as solicitações ou informe a transportadora.",
      );
    }

    const cd21 = await this.getCd21();
    const { groups, skipped } = await this.resolvePdvBatchGroups(
      params,
      PDV_BATCH_ACTION_RULES.add,
    );

    const [onlySelected] = groups;
    if (groups.length === 1 && !onlySelected.transporter && !params.batchId) {
      const accessKeys = await this.saleInvoiceAccessKeys(onlySelected.invoiceIds);
      // Ponteiro reconciliado antes: addInvoiceToLastOutgoingBatch confia nele e falha se apontar pra lote FINISHED.
      await unitBusinessService.getOrUpdateLastOutgoingBatchNumber(cd21.id);
      const batch = await this.addInvoiceToLastOutgoingBatch(
        accessKeys,
        cd21.id,
        "OUTGOING",
      );
      await pdvSalesRequestService.notifyChangedBySaleInvoiceIds(onlySelected.invoiceIds);
      return { batches: [batch], skipped: [], warnings: [] };
    }

    const results = await Promise.all(
      groups.map(async (group) => {
        try {
          const [pendingBatch] =
            await this.repository.findPendingOutgoingByTransporter(
              cd21.id,
              group.transporter,
              params.batchId,
            );
          if (!pendingBatch) {
            const reason = params.batchId
              ? "O lote escolhido não está mais pendente ou não é desta transportadora."
              : `Nenhum lote pendente ${group.transporterName ? `da transportadora ${group.transporterName} ` : ""}no CD21. Gere um lote primeiro.`;
            return this.pdvSkipped(PdvBatchSkipReason.NO_PENDING_BATCH, group, reason);
          }

          const accessKeys = await this.saleInvoiceAccessKeys(group.invoiceIds);
          const batch = await this.addInvoiceToBatch(
            accessKeys,
            cd21.id,
            "OUTGOING",
            pendingBatch.id,
          );
          await pdvSalesRequestService.notifyChangedBySaleInvoiceIds(group.invoiceIds);
          return batch;
        } catch (error: any) {
          return this.pdvSkipped(PdvBatchSkipReason.FAILED, group, error.message);
        }
      }),
    );

    const batches = results.filter(
      (result): result is ExpeditionBatch => !("reason_code" in result),
    );
    skipped.push(
      ...results.filter(
        (result): result is PdvBatchSkipped => "reason_code" in result,
      ),
    );
    return this.pdvBatchActionResult(batches, skipped);
  }

  // Um romaneio por lote distinto das notas; escolhidas só precisam estar em lote.
  async generateDeliveryNoteFromPdv(params: PdvBatchActionParams, userId: string) {
    const cd21 = await this.getCd21();
    const { groups } = await this.resolvePdvBatchGroups(
      params,
      PDV_BATCH_ACTION_RULES.deliveryNote,
    );
    const invoiceIds = groups.flatMap((group) => group.invoiceIds);
    const batchIds = await this.batchIdsOfSaleInvoices(invoiceIds, cd21.id);

    const batches = await Promise.all(
      batchIds.map((batchId) => this.generateDeliveryNote(batchId, userId)),
    );
    await pdvSalesRequestService.notifyChangedBySaleInvoiceIds(invoiceIds);
    return { batches, skipped: [], warnings: [] };
  }

  // Opções de batch_id pro addPdvToBatch — sem cd/transporter_id, todos os pendentes de saída do CD21.
  async findPdvPendingBatches(
    params: Omit<PdvBatchActionParams, "salesRequestIds">,
  ): Promise<ExpeditionBatch[]> {
    const transporter = this.hasPdvTransporter(params)
      ? this.resolvePdvTransporter(params, this.resolvePdvColumn(params.status))
      : null;
    const cd21 = await this.getCd21();
    return this.repository.findPendingOutgoingByTransporter(
      cd21.id,
      transporter,
    );
  }

  private hasPdvTransporter(
    params: Omit<PdvBatchActionParams, "salesRequestIds">,
  ): boolean {
    return !!params.cd || !!params.transporterId;
  }

  private resolvePdvColumn(status: string): PdvSalesRequestStatus {
    const column = PDV_BATCH_COLUMNS.find((allowed) => allowed === status);
    if (!column) {
      throw new Error(
        `Ações de lote só existem nas colunas ${PDV_BATCH_COLUMNS.map((allowed) => `"${CD21_STATUS_LABELS[allowed]}"`).join(" e ")}.`,
      );
    }
    return column;
  }

  // SHIPPING (ADT) usa CD 12/17; SHIP_TODAY usa transportadora cadastrada.
  private resolvePdvTransporter(
    params: Omit<PdvBatchActionParams, "salesRequestIds">,
    status: PdvSalesRequestStatus,
  ): PdvTransporterSelector {
    if (status === PdvSalesRequestStatus.SHIPPING) {
      if (!params.cd) {
        throw new Error(
          `Na coluna "${CD21_STATUS_LABELS[status]}", informe o CD (12 ou 17).`,
        );
      }
      assertAdtTransporterCd(params.cd);
      return { cd: params.cd };
    }
    if (!params.transporterId) {
      throw new Error(
        `Na coluna "${CD21_STATUS_LABELS[status]}", informe a transportadora.`,
      );
    }
    return { transporterId: params.transporterId };
  }

  // Só ids (card): escolhidas sem checar coluna/transportadora. Com transportadora: escolhidas validadas contra ela, ou todas no estágio da ação. Só a coluna: todas no estágio, um grupo por transportadora.
  private async resolvePdvBatchGroups(
    params: PdvBatchActionParams,
    rule: PdvBatchActionRule,
  ): Promise<{ groups: PdvBatchGroup[]; skipped: PdvBatchSkipped[] }> {
    const selectedIds = [...new Set(params.salesRequestIds ?? [])];
    const hasTransporter = this.hasPdvTransporter(params);

    if (selectedIds.length && !hasTransporter) {
      return { groups: [await this.selectedPdvBatchGroup(selectedIds, null, rule)], skipped: [] };
    }

    const status = this.resolvePdvColumn(params.status);
    const transporter = hasTransporter
      ? this.resolvePdvTransporter(params, status)
      : null;
    const scope = `"${CD21_STATUS_LABELS[status]}"${transporter ? ` da ${describeTransporterSelector(transporter)}` : ""}`;

    if (selectedIds.length) {
      const [selected, inColumn] = await Promise.all([
        pdvSalesRequestService.findBatchTargets({ ids: selectedIds }),
        pdvSalesRequestService.findBatchTargets({
          ids: selectedIds,
          status,
          transporter: transporter!,
        }),
      ]);
      const inColumnIds = new Set(inColumn.map((target) => target.id));
      const outside = selected.filter((target) => !inColumnIds.has(target.id));
      if (outside.length) {
        const orders = this.pdvOrderNumbers(outside).join(", ");
        throw new Error(
          selected.length === 1
            ? `A solicitação do pedido ${orders} não está em ${scope}.`
            : `Nem todas as solicitações selecionadas estão em ${scope}. Fora: pedidos ${orders}.`,
        );
      }
      return {
        groups: [await this.selectedPdvBatchGroup(selectedIds, transporter, rule)],
        skipped: [],
      };
    }

    const targets = await pdvSalesRequestService.findBatchTargets({
      status,
      transporter: transporter ?? undefined,
      batchStage: rule.defaultStage,
    });
    if (!targets.length) {
      throw new Error(
        `Nenhuma solicitação ${PDV_BATCH_STAGE_LABELS[rule.defaultStage]} em ${scope}.`,
      );
    }
    if (transporter || !rule.groupByTransporter) {
      return { groups: [this.pdvBatchGroup(transporter, targets)], skipped: [] };
    }

    const byTransporter = new Map<string, PdvBatchTarget[]>();
    const withoutTransporter: PdvBatchTarget[] = [];
    for (const target of targets) {
      if (!target.transporter_id) {
        withoutTransporter.push(target);
        continue;
      }
      byTransporter.set(target.transporter_id, [
        ...(byTransporter.get(target.transporter_id) ?? []),
        target,
      ]);
    }

    return {
      groups: [...byTransporter].map(([transporterId, group]) =>
        this.pdvBatchGroup({ transporterId }, group),
      ),
      skipped: withoutTransporter.length
        ? [
            this.pdvSkipped(
              PdvBatchSkipReason.NO_TRANSPORTER,
              this.pdvBatchGroup(null, withoutTransporter),
              `Pedidos ${this.pdvOrderNumbers(withoutTransporter).join(", ")} sem transportadora na nota de venda — não foram processados.`,
            ),
          ]
        : [],
    };
  }

  // resolveSaleInvoiceIds antes do estágio: re-sincroniza sale_invoice_id, que o literal de estágio lê.
  private async selectedPdvBatchGroup(
    selectedIds: string[],
    transporter: PdvTransporterSelector | null,
    rule: PdvBatchActionRule,
  ): Promise<PdvBatchGroup> {
    const invoiceIds = await pdvSalesRequestService.resolveSaleInvoiceIds(selectedIds);
    const [selected, inStage] = await Promise.all([
      pdvSalesRequestService.findBatchTargets({ ids: selectedIds }),
      pdvSalesRequestService.findBatchTargets({
        ids: selectedIds,
        batchStage: rule.selectedStage,
      }),
    ]);
    const inStageIds = new Set(inStage.map((target) => target.id));
    const outside = selected.filter((target) => !inStageIds.has(target.id));
    if (outside.length) {
      throw new Error(
        rule.selectedNotInStage(
          this.pdvOrderNumbers(outside).join(", "),
          selected.length === 1,
        ),
      );
    }
    return { ...this.pdvBatchGroup(transporter, selected), invoiceIds };
  }

  private pdvBatchGroup(
    transporter: PdvTransporterSelector | null,
    targets: PdvBatchTarget[],
  ): PdvBatchGroup {
    return {
      transporter,
      transporterId: targets[0]?.transporter_id ?? null,
      transporterName: targets[0]?.transporter_name ?? null,
      salesRequestIds: targets.map((target) => target.id),
      orderNumbers: this.pdvOrderNumbers(targets),
      invoiceIds: [
        ...new Set(
          targets
            .map((target) => target.sale_invoice_id)
            .filter((id): id is string => !!id),
        ),
      ],
    };
  }

  private pdvOrderNumbers(targets: PdvBatchTarget[]): string[] {
    return targets.map((target) => target.order_number ?? target.id);
  }

  private pdvSkipped(
    reasonCode: PdvBatchSkipReason,
    group: PdvBatchGroup,
    reason: string,
  ): PdvBatchSkipped {
    return {
      reason_code: reasonCode,
      reason,
      transporter_id: group.transporterId,
      transporter_name: group.transporterName,
      sales_request_ids: group.salesRequestIds,
      order_numbers: group.orderNumbers,
    };
  }

  // Sucesso parcial devolve avisos; nada processado vira erro (1 grupo → a mensagem dele).
  private pdvBatchActionResult<T>(
    batches: T[],
    skipped: PdvBatchSkipped[],
  ): PdvBatchActionResult<T> {
    const warnings = this.pdvBatchWarnings(skipped);
    if (!batches.length) {
      throw new Error(skipped.length === 1 ? skipped[0].reason : warnings.join(" "));
    }
    return { batches, skipped, warnings };
  }

  private pdvBatchWarnings(skipped: PdvBatchSkipped[]): string[] {
    const ofReason = (code: PdvBatchSkipReason) =>
      skipped.filter((entry) => entry.reason_code === code);
    const noPendingBatch = ofReason(PdvBatchSkipReason.NO_PENDING_BATCH);
    const noTransporter = ofReason(PdvBatchSkipReason.NO_TRANSPORTER);

    return [
      ...(noPendingBatch.length
        ? [
            `Sem lote pendente no CD21 para as transportadoras: ${noPendingBatch.map((entry) => entry.transporter_name ?? `pedidos ${entry.order_numbers.join(", ")}`).join(", ")}. Essas solicitações não foram adicionadas.`,
          ]
        : []),
      ...noTransporter.map((entry) => entry.reason),
      ...ofReason(PdvBatchSkipReason.FAILED).map(
        (entry) =>
          `${entry.transporter_name ?? `Pedidos ${entry.order_numbers.join(", ")}`}: ${entry.reason}`,
      ),
    ];
  }

  // Lotes distintos (CD21) das notas — toda nota precisa estar em lote.
  private async batchIdsOfSaleInvoices(
    invoiceIds: string[],
    cd21Id: string,
  ): Promise<string[]> {
    const batchIdByInvoiceId =
      await batchInvoicesService.findBatchIdsByInvoiceIds(invoiceIds, cd21Id);
    const notInBatch = invoiceIds.filter((id) => !batchIdByInvoiceId.has(id));
    if (notInBatch.length) {
      const numbers = await this.invoiceNumbers(notInBatch);
      throw new Error(`Nota de venda ainda não está em um lote: ${numbers}`);
    }
    return [...new Set(batchIdByInvoiceId.values())];
  }

  async getPdvSalesRequestBatchStatus(
    salesRequestId: string,
  ): Promise<{
    in_batch: boolean;
    batch_finished: boolean;
    delivery_note_generated: boolean;
  }> {
    const invoiceId =
      await pdvSalesRequestService.resolveSaleInvoiceId(salesRequestId);

    return this.getBatchStatusByInvoiceId(invoiceId);
  }

  // Lote de saída do CD21 que contém a nota.
  async getBatchStatusByInvoiceId(invoiceId: string): Promise<{
    in_batch: boolean;
    batch_finished: boolean;
    delivery_note_generated: boolean;
  }> {
    const cd21 = await this.getCd21();

    const batchId = await batchInvoicesService.findBatchIdByInvoiceId(
      invoiceId,
      cd21.id,
    );
    if (!batchId) {
      return {
        in_batch: false,
        batch_finished: false,
        delivery_note_generated: false,
      };
    }

    const batch = await this.findById(batchId, {
      attributes: ["id", "status", "delivery_note_generated_at"],
    });
    return {
      in_batch: true,
      batch_finished: batch?.status === "FINISHED",
      delivery_note_generated: !!batch?.delivery_note_generated_at,
    };
  }

  // addInvoiceToBatch/addInvoiceToLastOutgoingBatch recebem chave de acesso, não id.
  private async saleInvoiceAccessKeys(invoiceIds: string[]): Promise<string[]> {
    const invoices = await invoiceService.findAll({
      where: { id: { [Op.in]: invoiceIds } },
      attributes: ["id", "xml_key", "number_system"],
    });
    const withoutKey = invoices.filter((invoice) => !invoice.xml_key);
    if (withoutKey.length || invoices.length !== invoiceIds.length) {
      throw new Error(
        `Nota de venda sem chave de acesso: ${withoutKey.map((invoice) => invoice.number_system).join(", ")}`,
      );
    }
    return invoices.map((invoice) => invoice.xml_key!);
  }

  private async invoiceNumbers(invoiceIds: string[]): Promise<string> {
    const invoices = await invoiceService.findAll({
      where: { id: { [Op.in]: invoiceIds } },
      attributes: ["number_system"],
    });
    return invoices.map((invoice) => invoice.number_system).join(", ");
  }

  // Rotas do link CD21 não recebem loja do front — sempre CD21.
  async searchCd21PendingOutgoing(
    params: QueryParams,
  ): Promise<PaginatedResult<ExpeditionBatch>> {
    const cd21 = await this.getCd21();
    return this.searchPendingOutgoing(params, cd21.id);
  }

  private async getCd21(): Promise<UnitBusiness> {
    const cd21 = await unitBusinessService.getCd21UnitBusiness();
    if (!cd21) throw new Error("Unidade CD21 não cadastrada");
    return cd21;
  }

  async getBatchesByInvoiceIds(
    invoiceIds: string[],
    unitBusinessId: string,
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
              include: [
                {
                  model: Stock,
                  as: "stocks",
                  where: {
                    unit_business_id: unitBusinessId,
                  },
                },
              ],
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

    async searchPendingOutgoing(
    params: QueryParams,
    unitBusinessId: string,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<ExpeditionBatch>> {
    return super.paginate(
      params,
      {
        ...extraOptions,
        include: [
          {
            model: UnitBusiness,
            as: "unitBusiness",
            where: {
              id: unitBusinessId,
            }
          },
          {
            model: Transporter,
            as: "transporter",
          },
        ],
      },
      { status: { [Op.in]: ["OPEN", "PENDING"] } },
    );
  }

  async finishBatch(batchId: string, justification: string, user: any) {
    const fullBatch = await sequelize.transaction(async (t) => {
      const batch = await this.finishBatchTransaction(
        batchId,
        justification,
        t,
      );

      if (batch.integration?.name == "Tecinco") {
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
      }

      return batch;
    });

    await pdvSalesRequestService.notifyChangedBySaleInvoiceIds(
      (fullBatch.batchInvoices ?? []).map((bi) => bi.invoice_id),
    );

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

    const tecincoIntegration = await integrationsService.getFullIntegration({
      where: {
        name: "Tecinco",
      },
    });

    if (fullBatch.integrations_id != tecincoIntegration.id) {
      console.log("Lote não pertence a tecinco! Ignorado.");
      return;
    }

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

    // Auto-finish de solicitações PDV que só esperavam o romaneio pra
    // finalizar — ver pdv-sales-request.service.ts::finishIfDeliveryNoteGenerated.
    // No-op pra lotes sem nenhuma nota vinculada a uma PdvSalesRequest.
    await pdvSalesRequestService.finishIfDeliveryNoteGenerated(
      (updatedBatch.batchInvoices ?? []).map((bi) => bi.invoice_id),
    );

    return updatedBatch;
  }

  async downloadDeliveryNotes(batchesId: string[]) {
    const batches = await this.repository.getFullBatches(batchesId);
    return batches;
  }

  private async assertDeletable(batchIds: string[]): Promise<void> {
    const batchInvoices = await batchInvoicesService.findAll({
      where: { expedition_batch_id: { [Op.in]: batchIds } },
    });

    const [batchItem, batchInvoiceItem, scanLog] = await Promise.all([
      batchItemsService.findOne({
        where: { expedition_batch_id: { [Op.in]: batchIds } },
      }),
      batchInvoices.length
        ? batchInvoiceItemsService.findOne({
            where: {
              expedition_batch_invoice_id: batchInvoices.map((bi) => bi.id),
            },
          })
        : null,
      scanLogsService.findOne({
        where: { expedition_batch_id: { [Op.in]: batchIds } },
      }),
    ]);

    if (batchItem || batchInvoices.length || batchInvoiceItem || scanLog) {
      throw new Error("Não é possível excluir um lote com itens");
    }
  }

  async delete(id: string, options?: DestroyOptions): Promise<any> {
    await this.assertDeletable([id]);

    return super.delete(id, options);
  }

  async bulkDelete(options: DestroyOptions): Promise<number> {
    const whereId = (options.where as any)?.id;
    const batchIds: string[] = Array.isArray(whereId)
      ? whereId
      : whereId?.[Op.in] ?? (whereId ? [whereId] : []);

    if (batchIds.length) {
      await this.assertDeletable(batchIds);
    }

    return super.bulkDelete(options);
  }

  async batchReport(id: string): Promise<ExpeditionBatchFull> {
    if (!id) {
      throw new Error("Id do lode não informado!");
    }

    const data = await this.repository.getFullBatch(id);

    return data;
  }
}

export default new ExpeditionBatchService();
