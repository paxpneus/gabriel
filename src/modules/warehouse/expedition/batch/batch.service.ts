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
  ExpeditionBatchAttributes,
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
import {
  DestroyOptions,
  FindOptions,
  Op,
  Transaction,
  UpdateOptions,
  WhereOptions,
  col,
  fn,
} from "sequelize";
import UnitBusiness from "../../../company/unit-business/unit-business.model";
import { setBatchNumber } from "../../../../shared/utils/normalizers/batch-nomenclature";
import { cleanDocument } from "../../../../shared/utils/normalizers/document";
import { endOfDayTz, startOfDayTz } from "../../../../shared/utils/normalizers/date";
import {
  invoiceService,
  buildBlingEntranceInvoiceUrl,
  internalInvoiceScopeService,
  INTERNAL_BATCH_REFUSED_MESSAGE,
  INTERNAL_INVOICE_REFUSED_MESSAGE,
} from "../../fiscal/invoices/invoice";
import invoiceItemsService from "../../fiscal/invoices/invoice-items/invoice-items.service";
import { ensureSameBy } from "../../../../shared/utils/validators/same-not-allowed";
import transporterService from "../../transporter/transporter.service";
import Transporter from "../../transporter/transporter.model";
import integrationsService from "../../../integrations/integrations/integrations.service";
import {
  assertTransshipment,
  batchAttributeWhere,
  BatchType,
  isTransshipmentInvoice,
  pickBatchAttribute,
} from "../utils/helpers/transshipment-resolver";
import batchInvoicesService from "../batch-invoices/batch-invoices.service";
import batchItemsService from "../batch-items/batch-items.service";
import batchInvoiceItemsService from "../batch-invoice-items/batch-invoice-items.service";
import InvoiceUnitBusinessAttributes from "../../fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import unitBusinessService from "../../../company/unit-business/unit-business.service";
import { FullInvoice } from "../../fiscal/invoices/invoice/invoice.types";
import unmappedInvoiceProductService from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
import scanLogsService from "../scan-logs/scan-logs.service";
import pdvSalesRequestService from "../../../sales/pdv-management/sales-request/pdv-sales-request.service";
import auditLogService from "../../../global/audit-logs/audit-log.service";
import AuditLog from "../../../global/audit-logs/audit-log.model";
import { AuditEntity } from "../../../global/audit-logs/audit-log.types";
import userService from "../../../company/users/users/user.service";
import { deliveryNoteGeneratedAudit } from "./helpers/audit";
import { assertAdtBatchTransferReferences } from "./helpers/transfer-reference";
import { isCd21TransferQrRule, resolveCd21TransferInvoiceIds } from "./helpers/cd21-transfer-qr";
import { CD21_UNIT_BUSINESS_NUMBER } from "../../../company/unit-business/helpers/cd21-unit-business-number";
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
import { randomUUID } from "crypto";
import {
  BLING_FETCH_CREATE_PRODUCT_PRIORITY,
  BlingApiFetchQueue,
  BlingInvoiceItemsCheckResult,
  blingInvoiceResyncJobId,
} from "../../../handlers/bling/services/bling/queues/bling-api-fetch.queue";
import { getBlingIntegration } from "../../../handlers/bling/api/bling_api.service";
import { FINAL_JOB_STATUSES, JobStatus, toJobStatus } from "../../../../shared/utils/queues/job-status";
import { UNMAPPED_REASONS_NOT_RECONCILED_IN_BLING } from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.types";

// Avaliação de conciliação na Bling (lote de entrada): prefixo do jobId e retenção do job concluído — a retenção é também a validade da avaliação.
const BLING_RECONCILIATION_CHECK_JOB_PREFIX = "bling-invoice-items-check-";
const BLING_RECONCILIATION_CHECK_RETENTION_SECONDS = 3600;

// Complemento das mensagens de "nenhuma candidata" das ações de lote do PDV.
const PDV_BATCH_STAGE_LABELS: Record<PdvBatchStage, string> = {
  [PdvBatchStage.WITHOUT_BATCH]: "sem lote",
  [PdvBatchStage.IN_BATCH]: "em lote",
  [PdvBatchStage.OPEN_BATCH]: "em lote pendente",
  [PdvBatchStage.FINISHED_BATCH]: "em lote finalizado",
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
    selectedStage: PdvBatchStage.FINISHED_BATCH,
    groupByTransporter: false,
    selectedNotInStage: (orders: string, single: boolean) =>
      single
        ? `A solicitação do pedido ${orders} ainda não está em um lote finalizado.`
        : `Nem todas as solicitações estão em um lote finalizado. Sem lote ou com lote em aberto: pedidos ${orders}.`,
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
  // Client workless da BLING_API_FETCH: só enfileira/lê o job de avaliação de conciliação.
  private blingApiFetchQueue?: BlingApiFetchQueue;

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
        // filters[delivery_note_generated_at][start|end]=AAAA-MM-DD, dias inteiros em horário de Brasília (o range genérico
        // do QueryParser mistura UTC e fuso local e corta o dia). Em Op.and pra não sobrescrever o delivery_note_generated.
        delivery_note_generated_at: (value) => {
          const { start, end } = (value ?? {}) as unknown as { start?: string; end?: string };
          for (const date of [start, end]) {
            if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
              throw new Error("Data do romaneio inválida (use AAAA-MM-DD)");
            }
          }
          const range: Record<symbol, Date> = {};
          if (start) range[Op.gte] = startOfDayTz(start).toDate();
          if (end) range[Op.lte] = endOfDayTz(end).toDate();
          if (!start && !end) return {};
          return { [Op.and]: [{ delivery_note_generated_at: range }] };
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
    transshipmentInvoiceIds?: ReadonlySet<string>,
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
        transshipmentInvoiceIds,
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

  // Conciliação na Bling só na entrada do CD21 (uma vez, quando a nota chega ao CD); demais lojas/etapas não validam.
  private isCd21Entrance(type: string | undefined, unitBusinessNumber: string | null | undefined): boolean {
    return type === "INCOMING" && unitBusinessNumber === CD21_UNIT_BUSINESS_NUMBER;
  }

  /**
   * 1ª etapa do lote de entrada: enfileira na BLING_API_FETCH a busca dos itens das notas Bling e devolve o jobId
   * pro front acompanhar. jobId null = nenhuma nota da Bling, pode gerar o lote direto.
   */
  async enqueueBlingReconciliationCheck(params: {
    invoiceIds?: string[];
    invoiceKeys?: string[];
    unitBusinessId?: string;
  }): Promise<{ jobId: string | null; message: string; syncing?: boolean }> {
    const invoiceIds = [...new Set((params.invoiceIds ?? []).filter(Boolean))];
    const invoiceKeys = [
      ...new Set((params.invoiceKeys ?? []).map((k) => String(k).replace(/\s/g, "")).filter(Boolean)),
    ];
    if (!invoiceIds.length && !invoiceKeys.length) {
      throw new Error("Informe ao menos uma nota fiscal");
    }

    let where: WhereOptions;
    if (invoiceIds.length) {
      where = { id: { [Op.in]: invoiceIds } };
    } else {
      where = { xml_key: { [Op.in]: invoiceKeys } };
    }
    const invoices = await invoiceService.findAll({
      where,
      attributes: ["id", "xml_key", "number_system", "id_system", "integrations_id"],
    });

    const expected = invoiceIds.length ? invoiceIds : invoiceKeys;
    const found = new Set(invoices.map((i) => (invoiceIds.length ? i.id : i.xml_key)));
    const missing = expected.filter((value) => !found.has(value));
    if (missing.length) {
      throw new Error(`Nota(s) não encontrada(s): ${missing.join(", ")}`);
    }

    // Fora da entrada do CD21 não há avaliação: o front gera o lote direto.
    const readerUnit = params.unitBusinessId
      ? await unitBusinessService.findById(params.unitBusinessId, { attributes: ["id", "number"] })
      : null;
    if (!this.isCd21Entrance("INCOMING", readerUnit?.number)) {
      return { jobId: null, message: "A conciliação na Bling só é avaliada na entrada do CD21 — o lote pode ser gerado." };
    }

    const blingIntegration = await getBlingIntegration();
    const blingInvoices = invoices.filter((i) => i.integrations_id === blingIntegration.id);
    if (!blingInvoices.length) {
      return { jobId: null, message: "Nenhuma nota da Bling — o lote pode ser gerado." };
    }

    const withoutBlingId = blingInvoices.filter((i) => !Number(i.id_system));
    if (withoutBlingId.length) {
      throw new Error(
        `Nota(s) sem identificação da Bling: ${withoutBlingId.map((i) => i.number_system).join(", ")}`,
      );
    }

    // Reprocesso da nota (disparado por avaliação anterior) ainda na fila: não avalia, front espera a sincronização.
    const syncing = await this.findSyncingBlingInvoices(blingInvoices);
    if (syncing.length) {
      return {
        jobId: null,
        syncing: true,
        message: `Aguarde a sincronização da(s) nota(s) ${syncing.map((i) => i.number_system).join(", ")} entre Bling e Hub e tente novamente.`,
      };
    }

    // Notas com item não conciliado no hub: se a Bling já tiver todos os códigos, o job reprocessa a nota.
    const pendingRows = await unmappedInvoiceProductService.findUnmappedByInvoiceIds(
      blingInvoices.map((i) => i.id),
    );
    const pendingInvoiceIds = new Set(
      pendingRows
        .filter((row) => UNMAPPED_REASONS_NOT_RECONCILED_IN_BLING.includes(row.reason))
        .map((row) => row.invoice_id),
    );
    const resyncBlingIds = blingInvoices
      .filter((i) => pendingInvoiceIds.has(i.id))
      .map((i) => Number(i.id_system));

    // jobId único por avaliação: depois de conciliar na Bling, uma nova avaliação busca os itens de novo.
    const blingIds = blingInvoices.map((i) => Number(i.id_system));
    const jobId = `${BLING_RECONCILIATION_CHECK_JOB_PREFIX}${randomUUID()}`;
    this.blingApiFetchQueue ??= new BlingApiFetchQueue({ workless: true });
    await this.blingApiFetchQueue.add(
      {
        eventId: jobId,
        resource: "invoice_items_check",
        action: "updated",
        companyId: "",
        date: new Date().toISOString(),
        rawData: null,
        apiFetch: {
          resource: "invoice_items_check",
          blingId: blingIds[0],
          blingIds,
          resyncBlingIds,
          action: "updated",
          companyId: "",
        },
      },
      jobId,
      {
        priority: BLING_FETCH_CREATE_PRODUCT_PRIORITY,
        removeOnComplete: { age: BLING_RECONCILIATION_CHECK_RETENTION_SECONDS },
      },
    );

    return {
      jobId,
      message: "Avaliando na Bling se todos os produtos da(s) nota(s) foram conciliados...",
    };
  }

  // Notas Bling cujo reprocesso (enfileirado pela avaliação) ainda não terminou.
  private async findSyncingBlingInvoices<T extends { id_system?: string }>(invoices: T[]): Promise<T[]> {
    this.blingApiFetchQueue ??= new BlingApiFetchQueue({ workless: true });
    const queue = this.blingApiFetchQueue.queue;
    const statuses = await Promise.all(
      invoices.map(async (invoice) => (await toJobStatus(await queue.getJob(blingInvoiceResyncJobId(invoice.id_system!)))).status),
    );
    return invoices.filter((_, idx) => !FINAL_JOB_STATUSES.has(statuses[idx]));
  }

  // Status do job de avaliação pro polling do front; só aceita jobs dessa avaliação.
  async getBlingReconciliationCheckStatus(
    jobId: string,
  ): Promise<{ status: JobStatus; error?: string }> {
    if (!jobId?.startsWith(BLING_RECONCILIATION_CHECK_JOB_PREFIX)) {
      return { status: "not_found" };
    }
    this.blingApiFetchQueue ??= new BlingApiFetchQueue({ workless: true });
    return toJobStatus(await this.blingApiFetchQueue.queue.getJob(jobId));
  }

  /**
   * Trava do lote de entrada: as notas Bling precisam de uma avaliação concluída (blingCheckJobId) cobrindo todas
   * elas, e todo item da nota na Bling precisa ter código (produto conciliado). Senão erro com o link de cada nota.
   */
  private async assertBlingEntranceReconciled(
    invoices: { number_system?: string; id_system?: string; integrations_id?: string }[],
    blingCheckJobId?: string,
  ): Promise<void> {
    const blingIntegration = await getBlingIntegration();
    const blingInvoices = invoices.filter((i) => i.integrations_id === blingIntegration.id);
    if (!blingInvoices.length) return;

    if (!blingCheckJobId) {
      throw new Error("Avalie a conciliação dos produtos na Bling antes de gerar o lote de entrada.");
    }

    this.blingApiFetchQueue ??= new BlingApiFetchQueue({ workless: true });
    const job = blingCheckJobId.startsWith(BLING_RECONCILIATION_CHECK_JOB_PREFIX)
      ? await this.blingApiFetchQueue.queue.getJob(blingCheckJobId)
      : null;
    const { status, error } = await toJobStatus(job);
    if (status === "not_found") {
      throw new Error("Avaliação da conciliação na Bling não encontrada ou expirada. Avalie novamente.");
    }
    if (status === "failed") {
      throw new Error(`A avaliação da conciliação na Bling falhou: ${error}. Avalie novamente.`);
    }
    if (status !== "completed") {
      throw new Error("A avaliação da conciliação na Bling ainda não terminou.");
    }

    const result = job!.returnvalue as BlingInvoiceItemsCheckResult;
    const itemsByBlingId = new Map(
      (result?.invoices ?? []).map((inv) => [String(inv.blingId), inv.items]),
    );

    const notEvaluated = blingInvoices.filter((i) => !itemsByBlingId.has(String(i.id_system)));
    if (notEvaluated.length) {
      throw new Error(
        `A avaliação não inclui a(s) nota(s) ${notEvaluated.map((i) => i.number_system).join(", ")}. Avalie novamente.`,
      );
    }

    const notReconciled = blingInvoices.filter((i) =>
      itemsByBlingId.get(String(i.id_system))!.some((item) => !item.codigo?.trim()),
    );
    if (notReconciled.length) {
      const links = notReconciled
        .map((i) => `nota ${i.number_system} (${buildBlingEntranceInvoiceUrl(i.id_system!)})`)
        .join(", ");
      throw new Error(
        `Nota(s) com produtos não conciliados na Bling. Concilie os produtos da nota antes de gerar o lote: ${links}`,
      );
    }

    // Tudo conciliado na Bling, mas o reprocesso da nota no hub ainda roda: esperar antes de gerar.
    const syncing = await this.findSyncingBlingInvoices(blingInvoices);
    if (syncing.length) {
      throw new Error(
        `Aguarde a sincronização da(s) nota(s) ${syncing.map((i) => i.number_system).join(", ")} entre Bling e Hub e tente novamente.`,
      );
    }
  }

  // options.internal: só o domínio internal/ passa (lote de nota interna); nunca exposto na rota genérica.
  async generateBatchFromInvoices(
    invoiceIds: string[],
    unitBusinessId: string,
    type: string,
    mode?: string,
    blingCheckJobId?: string,
    options: { internal?: boolean } = {},
  ): Promise<ExpeditionBatch> {
    let batchId: string;
    const internalOperationId = await internalInvoiceScopeService.getInternalOperationId();

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

      // Nota interna só em lote interno (internal/) e lote interno só com nota interna: nunca misturam com NF-e.
      const internalCount = rawInvoices.filter(
        (invoice) => !!internalOperationId && invoice.invoice_operation_id === internalOperationId,
      ).length;
      if (options.internal && internalCount !== rawInvoices.length) {
        throw new Error("Só nota interna neste lote");
      }
      if (!options.internal && internalCount > 0) {
        throw new Error(INTERNAL_INVOICE_REFUSED_MESSAGE);
      }

      const unitBusiness = await unitBusinessService.findOne({
        where: { id: unitBusinessId },
        transaction: t,
      });

      // Transbordo: a loja tem uma linha por type, e vale a do type deste lote.
      const invoices: FullInvoice[] = rawInvoices.map((invoice) => {
        const plain = invoice.get({ plain: true });
        const isTransshipment =
          !!unitBusiness && isTransshipmentInvoice(plain, unitBusiness.cnpj);
        return {
          ...plain,
          unitBusinessAttributes: pickBatchAttribute(
            plain.unitBusinessAttributes,
            type,
            isTransshipment,
          ),
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
        // Lote da nota nesta loja; no transbordo, o do mesmo type (a nota tem entrada e expedição aqui).
        const isTransshipment =
          !!unitBusiness && isTransshipmentInvoice(invoices[0], unitBusiness.cnpj);
        const existingBatchId = await batchInvoicesService.findBatchIdByInvoiceId(
          invoices[0].id,
          unitBusinessId,
          isTransshipment ? (type as BatchType) : undefined,
          t,
        );

        if (!existingBatchId) {
          throw new Error("Lote não encontrado para notas já processadas");
        }

        batchId = existingBatchId;
        return;
      }

      // Entrada do CD21 com nota Bling: todos os itens conciliados na Bling (avaliação prévia por job). Antes da trava de
      // não mapeados, porque item sem código na Bling também vira não mapeado e a causa é a conciliação.
      if (this.isCd21Entrance(type, unitBusiness?.number)) {
        await this.assertBlingEntranceReconciled(notBatched, blingCheckJobId);
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


      // Pedido PDV em CRITICAL_ERROR não entra em lote até o CD21 corrigir.
      await pdvSalesRequestService.assertNoCriticalErrorForSaleInvoices(
        notBatched.map((i) => i.id),
      );

      const transshipmentFlags = await Promise.all(
        notBatched.map((invoice) =>
          assertTransshipment(invoice, unitBusiness, type as BatchType, t),
        ),
      );
      const transshipmentInvoiceIds = new Set(
        notBatched.filter((_, i) => transshipmentFlags[i]).map((i) => i.id),
      );

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
        is_internal: !!options.internal,
      };

      const { batch } = await this.createBatchStructure(
        batchData,
        notBatched as any,
        t,
        transshipmentInvoiceIds,
      );

      // Na transação: a linha de atributo do transbordo foi criada nela (assertTransshipment).
      await invoiceService.updateInvoices(
        notBatched.map((i) => i.id),
        unitBusinessId,
        { batch_generated: true, status: "PENDING" },
        batchAttributeWhere(type, [...transshipmentInvoiceIds]),
        t,
      );

      batchId = batch.id;
    });

    return (await this.repository.getFullBatch(batchId!)) as ExpeditionBatch;
  }

  // QR do romaneio (id do lote de expedição de outra loja): gera o lote desta loja com as notas dele.
  // requestedType (tela escolheu entrada/expedição) é respeitado — expedição sem entrada finalizada dá erro, nunca vira entrada.
  // Sem ele, tipo por nota: emissora → expedição; destinatária → entrada; transbordo → entrada, ou expedição se já tem lote de entrada aqui.
  // Na expedição, nota destinada a esta loja fica fora (termina aqui); tela errada em nota da loja dá erro.
  async generateBatchFromQrCode(
    sourceBatchId: string,
    unitBusinessId: string,
    requestedType?: BatchType,
    mode?: string,
    blingCheckJobId?: string,
  ): Promise<ExpeditionBatch> {
    const sourceBatch = await this.findById(sourceBatchId, {
      attributes: ["id", "type", "unit_business_id"],
    });
    if (!sourceBatch || sourceBatch.type !== "OUTGOING") {
      throw new Error("O QR lido não é de um romaneio de expedição.");
    }
    if (sourceBatch.unit_business_id === unitBusinessId) {
      throw new Error("Este romaneio é desta própria loja.");
    }

    const sourceBatchInvoices = await batchInvoicesService.findAll({
      where: { expedition_batch_id: sourceBatchId },
      attributes: ["invoice_id"],
    });
    const invoiceIds = sourceBatchInvoices.map((bi) => bi.invoice_id);
    if (!invoiceIds.length) {
      throw new Error("O romaneio lido não tem notas.");
    }

    const [unitBusiness, sourceUnit, invoices, incomingBatchIdByInvoiceId] = await Promise.all([
      unitBusinessService.findById(unitBusinessId, {
        attributes: ["id", "cnpj", "number", "transshipment_allowed"],
      }),
      unitBusinessService.findById(sourceBatch.unit_business_id, { attributes: ["id", "cnpj", "number"] }),
      invoiceService.findAll({
        where: { id: invoiceIds },
        attributes: [
          "id",
          "number_system",
          "sender_cnpj",
          "receiver_cnpj",
          "transfer_invoice_reference",
          "transporter_name",
        ],
      }),
      batchInvoicesService.findBatchIdsByInvoiceIds(invoiceIds, unitBusinessId, "INCOMING"),
    ]);
    if (!unitBusiness || !sourceUnit) throw new Error("Loja não encontrada.");

    // Romaneio do CD21 (CD 12/17 ou sem transportadora) lido por loja 12/17: lote das notas de transferência de cada venda.
    if (isCd21TransferQrRule(sourceUnit, unitBusiness.number, invoices)) {
      if (requestedType === "OUTGOING") {
        throw new Error("As notas de transferência do romaneio são de entrada nesta loja. Use a tela de entrada.");
      }
      const transferInvoiceIds = await resolveCd21TransferInvoiceIds(invoices, unitBusiness.cnpj);
      return this.generateBatchFromInvoices(transferInvoiceIds, unitBusinessId, "INCOMING", mode, blingCheckJobId);
    }

    // Papel da loja em cada nota. Nota de outra loja em loja sem transbordo cai em transbordo-entrada e o assertTransshipment barra.
    type Note = { id: string; number: string };
    const unitCnpj = cleanDocument(unitBusiness.cnpj);
    const receivedNotes: Note[] = [];
    const sentNotes: Note[] = [];
    const transitNotesByType: Record<BatchType, Note[]> = { INCOMING: [], OUTGOING: [] };
    for (const invoice of invoices) {
      const note = { id: invoice.id, number: invoice.number_system ?? invoice.id };
      if (isTransshipmentInvoice(invoice, unitBusiness.cnpj)) {
        transitNotesByType[incomingBatchIdByInvoiceId.has(invoice.id) ? "OUTGOING" : "INCOMING"].push(note);
      } else if (cleanDocument(invoice.receiver_cnpj ?? "") === unitCnpj) {
        receivedNotes.push(note);
      } else {
        sentNotes.push(note);
      }
    }
    const numbers = (notes: Note[]) => notes.map((n) => n.number).join(", ");
    const outgoingNotes = [...sentNotes, ...transitNotesByType.OUTGOING];

    // Sem tipo pedido: expedição se alguma nota é de expedição nesta loja (as recebidas aqui não contam).
    const type: BatchType = requestedType ?? (outgoingNotes.length ? "OUTGOING" : "INCOMING");

    if (type === "INCOMING") {
      // Nota emitida pela loja não vira entrada pelo QR (tela errada).
      if (sentNotes.length) {
        throw new Error(`As notas ${numbers(sentNotes)} são de expedição nesta loja. Use a tela de expedição.`);
      }
      // Travas do generateBatchFromInvoices (assertTransshipment) valem como sempre; bipar de novo devolve o lote existente.
      return this.generateBatchFromInvoices(invoiceIds, unitBusinessId, type, mode, blingCheckJobId);
    }

    // Expedição: nota destinada a esta loja termina aqui e fica fora do lote.
    if (!outgoingNotes.length && !transitNotesByType.INCOMING.length) {
      throw new Error(`As notas ${numbers(receivedNotes)} são de entrada nesta loja. Use a tela de entrada.`);
    }
    // Sem tipo pedido, um lote tem um type só. Com tipo pedido, o assertTransshipment barra transbordo sem entrada finalizada.
    if (!requestedType && transitNotesByType.INCOMING.length) {
      throw new Error(
        `As notas do romaneio não são do mesmo tipo de lote nesta loja: entrada ${numbers(transitNotesByType.INCOMING)}; expedição ${numbers(outgoingNotes)}.`,
      );
    }
    const batchInvoiceIds = [...outgoingNotes, ...transitNotesByType.INCOMING].map((n) => n.id);
    return this.generateBatchFromInvoices(batchInvoiceIds, unitBusinessId, type, mode, blingCheckJobId);
  }

// options.internal: só o domínio internal/ passa — chavesAcesso viram ids de nota interna (sem chave) e o lote é interno.
async addInvoiceToBatch(
  chavesAcesso: string[],
  unitBusinessId: string,
  type: string,
  batchId?: string,
  transferInvoiceReference?: string,
  externalTransaction?: Transaction,
  blingCheckJobId?: string,
  options: { internal?: boolean } = {},
): Promise<ExpeditionBatch> {
  let resultBatchId: string;
  const internalOperationId = await internalInvoiceScopeService.getInternalOperationId();

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

    // Nota interna não tem chave de acesso: no fluxo interno a busca é pelo id da nota.
    const lookupField = options.internal ? "id" : "xml_key";
    const invoices = await invoiceService.findAll({
      where: { [lookupField]: cleanedChaves },
      include: [{ model: InvoiceItems, as: "items", required: false }],
      transaction: t,
    });

    if (!invoices.length) {
      throw new Error(
        options.internal
          ? "Nenhuma nota interna encontrada"
          : "Nenhuma nota encontrada para as chaves de acesso informadas",
      );
    }

    if (invoices.length !== cleanedChaves.length) {
      const foundKeys = invoices.map((i: any) => i[lookupField]);
      const missing = cleanedChaves.filter((c) => !foundKeys.includes(c));
      throw new Error(`Nota(s) não encontrada(s): ${missing.join(", ")}`);
    }

    // Nota interna só em lote interno e lote interno só com nota interna (mesma regra do generateBatchFromInvoices).
    const internalCount = invoices.filter(
      (invoice) => !!internalOperationId && invoice.invoice_operation_id === internalOperationId,
    ).length;
    if (options.internal && internalCount !== invoices.length) {
      throw new Error("Só nota interna neste lote");
    }
    if (!options.internal && internalCount > 0) {
      throw new Error(INTERNAL_INVOICE_REFUSED_MESSAGE);
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

    const unitBusiness = await unitBusinessService.findOne({
      where: { id: unitBusinessId },
      transaction: t,
    });

    // Entrada do CD21 com nota Bling: todos os itens conciliados na Bling (avaliação prévia por job). Antes da trava de
    // não mapeados, porque item sem código na Bling também vira não mapeado e a causa é a conciliação.
    if (this.isCd21Entrance(type, unitBusiness?.number)) {
      await this.assertBlingEntranceReconciled(invoices, blingCheckJobId);
    }

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


    // Pedido PDV em CRITICAL_ERROR não entra em lote até o CD21 corrigir.
    await pdvSalesRequestService.assertNoCriticalErrorForSaleInvoices(invoiceIds);

    // ── Todas as notas do lote precisam ser da mesma transportadora ──
    ensureSameBy(
      invoices,
      (i: any) => i.transporter_name,
      "Não é permitido adicionar notas com transportadoras diferentes ao lote!",
    );

    const transshipmentFlags = await Promise.all(
      invoices.map((invoice) =>
        assertTransshipment(invoice, unitBusiness, type as BatchType, t),
      ),
    );
    const transshipmentInvoiceIds = new Set(
      invoices.filter((_, i) => transshipmentFlags[i]).map((i) => i.id),
    );

    // ── Verifica se alguma dessas notas já está em algum batch_invoice NESSA unit_business ──
    // Transbordo: só conta lote do mesmo type (a nota tem entrada e expedição nesta loja).
    const alreadyInBatch = (
      await batchInvoicesService.findAll({
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
      })
    ).filter(
      (bi: any) =>
        !transshipmentInvoiceIds.has(bi.invoice_id) || bi.batch?.type === type,
    );

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
      // Lote interno só recebe nota pelo internal/ (e NF-e nunca entra nele).
      if (found.is_internal && !options.internal) throw new Error(INTERNAL_BATCH_REFUSED_MESSAGE);
      if (!found.is_internal && options.internal) throw new Error("Lote não é de nota interna");

      // Nota só entra em lote do mesmo tipo; exceção: transbordo (entrada e saída da mesma loja).
      const wrongType = plainInvoices.find(
        (i) => found.type !== type && !transshipmentInvoiceIds.has(i.id),
      );
      if (wrongType) {
        throw new Error(
          `Nota ${wrongType.number_system} é de ${type === "INCOMING" ? "entrada" : "saída"} e não pode entrar em lote de ${found.type === "INCOMING" ? "entrada" : "expedição"}`,
        );
      }

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
          transshipmentInvoiceIds,
        );

      await this.increment("total_volumes", {
        by: volumesAdded,
        where: { id: batchId },
        transaction: t,
      });

      if (transferInvoiceReference) {
        // updateInvoices valida 1 nota de venda ↔ 1 transferência — erro desfaz a transação inteira.
        await invoiceService.updateInvoices(
          plainInvoices.map((i) => i.id),
          unitBusinessId,
          { transfer_invoice_reference: transferInvoiceReference },
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
        is_internal: !!options.internal,
      };

      const { batch } = await this.createBatchStructure(
        batchData,
        plainInvoices as any,
        t,
        transshipmentInvoiceIds,
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
      batchAttributeWhere(type, [...transshipmentInvoiceIds]),
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
  transferInvoiceReference?: string,
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
      transferInvoiceReference,
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

  // Um romaneio por lote distinto das notas; escolhidas precisam estar em lote finalizado. operatorId vem do front (obrigatório).
  async generateDeliveryNoteFromPdv(
    params: PdvBatchActionParams,
    operatorId: string,
    actorUserId: string,
    correctionLetterJustification?: string | null,
  ) {
    const cd21 = await this.getCd21();
    const { groups } = await this.resolvePdvBatchGroups(
      params,
      PDV_BATCH_ACTION_RULES.deliveryNote,
    );
    const invoiceIds = groups.flatMap((group) => group.invoiceIds);
    const batchIds = await this.batchIdsOfSaleInvoices(invoiceIds, cd21.id);

    const batches = await Promise.all(
      batchIds.map((batchId) =>
        this.generateDeliveryNote(batchId, operatorId, actorUserId, correctionLetterJustification),
      ),
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
      await batchInvoicesService.findBatchIdsByInvoiceIds(invoiceIds, cd21Id, "OUTGOING");
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
      "OUTGOING",
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

  // forcedWhere repassado ao BaseService (filtro store_number do controller); opcional.
  // GET /batch: por padrão só lote de NF-e; filters[is_internal]=true lista só os lotes de nota interna.
  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
    forcedWhere?: WhereOptions,
  ): Promise<PaginatedResult<ExpeditionBatch>> {
    const { is_internal: isInternalFilter, ...filters } = params.filters ?? {};
    const isInternal = String(isInternalFilter) === "true";
    return super.paginate({ ...params, filters }, {
      ...extraOptions,
      // has_transshipment: selo "Transbordo" nas listagens de lote de entrada e de expedição.
      attributes: { include: [this.repository.hasTransshipmentAttribute()] },
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
    }, { ...forcedWhere, is_internal: isInternal });
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
      // Só lotes de saída: lote de entrada aberto não pode aparecer como destino de nota de saída.
      // Lote de nota interna fica fora da busca de lotes pendentes (inclusive a do CD21).
      { type: "OUTGOING", status: { [Op.in]: ["OPEN", "PENDING"] }, is_internal: false },
    );
  }

  // options.internal: só o internal/ finaliza lote de nota interna; a rota atual recusa.
  async finishBatch(batchId: string, justification: string, user: any, options: { internal?: boolean } = {}) {
    const fullBatch = await sequelize.transaction(async (t) => {
      const batch = await this.finishBatchTransaction(
        batchId,
        justification,
        t,
        options,
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
    options: { internal?: boolean } = {},
  ): Promise<ExpeditionBatchFull> {
    const fullBatch = await this.findByIdFullBatch(batchId);

    if (fullBatch.is_internal && !options.internal) throw new Error(INTERNAL_BATCH_REFUSED_MESSAGE);
    if (!fullBatch.is_internal && options.internal) throw new Error("Lote não é de nota interna");

    if (!fullBatch.batchInvoices?.length) {
      throw new Error("Não é possível finalizar um lote sem notas");
    }

    if (!fullBatch.batchInvoices.some((s) => s.items?.length)) {
      throw new Error("Não é possível finalizar um lote sem itens");
    }

    const invoicesIds = fullBatch.batchInvoices!.map((s) => s.invoice_id);

    // Mesmas travas do romaneio, antes de gravar. Transferência só no lote de saída: a entrada recebe nota CD 12/17 sem REF.
    if (fullBatch.type === "OUTGOING") {
      await assertAdtBatchTransferReferences(fullBatch, "finalizar o lote");
    }
    await pdvSalesRequestService.assertNoCriticalErrorForSaleInvoices(invoicesIds);

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
      // Transbordo: finaliza só a linha do type deste lote (a entrada finalizada libera a expedição).
      invoiceService.updateInvoices(
        invoicesIds,
        fullBatch.unit_business_id,
        { status: "FINISHED" },
        batchAttributeWhere(
          fullBatch.type!,
          fullBatch.batchInvoices!
            .filter((bi) => bi.is_transshipment)
            .map((bi) => bi.invoice_id),
        ),
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

  // operatorId = operador escolhido no front; actorUserId = usuário logado que gerou (vai pro audit log).
  // correctionLetterJustification: obrigatória se alguma nota do lote tem carta de correção e o lote ainda não tem uma.
  async generateDeliveryNote(
    batchId: string,
    operatorId: string,
    actorUserId: string | null,
    correctionLetterJustification?: string | null,
  ) {
    const batchInfo = await this.findByIdFullBatch(batchId);

    // Lote de nota interna não tem romaneio.
    if (batchInfo.is_internal) throw new Error(INTERNAL_BATCH_REFUSED_MESSAGE);

    // Romaneio só de lote finalizado — vale pra rota normal e pro PDV.
    if (batchInfo.status !== "FINISHED") {
      throw new Error(
        `O lote ${batchInfo.number} ainda não foi finalizado. Finalize o lote antes de gerar o romaneio.`,
      );
    }

    // Lote CD 12/17: toda nota referencia uma nota de transferência existente (ver helpers/transfer-reference.ts).
    await assertAdtBatchTransferReferences(batchInfo, "gerar o romaneio");

    // Nota com carta de correção saiu sem transferência: o romaneio precisa explicar o porquê (guardado no lote).
    const correctionLetterNumbers = (batchInfo.batchInvoices ?? [])
      .filter((bi) => bi.invoice.correction_letter_path)
      .map((bi) => bi.invoice.number_system);
    const justification = correctionLetterJustification?.trim() || null;
    if (correctionLetterNumbers.length && !justification && !batchInfo.correction_letter_justification) {
      throw new Error(
        `Nota(s) com carta de correção: ${correctionLetterNumbers.join(", ")}. Informe a justificativa da carta de correção para gerar o romaneio.`,
      );
    }

    // Antes de gravar o romaneio: pedido PDV em CRITICAL_ERROR barra a geração.
    await pdvSalesRequestService.assertNoCriticalErrorForSaleInvoices(
      (batchInfo.batchInvoices ?? []).map((bi) => bi.invoice_id),
    );

    const auditFields = ["delivery_note_generated_at", "operator_id", "correction_letter_justification"];
    await sequelize.transaction(async (t) => {
      // Antes travado: o audit registra o estado real que o UPDATE encontrou.
      const before = await this.findOne({
        attributes: auditFields,
        where: { id: batchId },
        lock: t.LOCK.UPDATE,
        transaction: t,
      });

      // COALESCE no próprio UPDATE: só grava data/operador se ainda vazios no banco — 2 gerações simultâneas não sobrescrevem.
      // Direto no repository: o bulkUpdate do service barraria a troca de operator_id.
      const deliveryNoteData: Partial<ExpeditionBatchAttributes> = {
        delivery_note_generated_at: fn(
          "COALESCE",
          col("delivery_note_generated_at"),
          fn("NOW"),
        ) as unknown as Date,
        operator_id: fn("COALESCE", col("operator_id"), operatorId) as unknown as string,
      };
      // Justificativa nova (lote com carta de correção) substitui a anterior.
      if (correctionLetterNumbers.length && justification) {
        deliveryNoteData.correction_letter_justification = justification;
      }
      await this.repository.bulkUpdate(deliveryNoteData, { where: { id: batchId }, transaction: t });

      const after = await this.findOne({
        attributes: auditFields,
        where: { id: batchId },
        transaction: t,
      });
      // O audit grava o nome do operador, não o id. Só o de depois: com o COALESCE, o de antes é ele ou vazio.
      let operator: { name: string } | null = null;
      if (after?.operator_id) {
        operator = await userService.findById(after.operator_id, {
          attributes: ["name"],
          transaction: t,
        });
      }

      await auditLogService.record(
        deliveryNoteGeneratedAudit({
          userId: actorUserId,
          batchId,
          batchNumber: batchInfo.number,
          operatorName: operator?.name ?? null,
          before: before!,
          after: after!,
        }),
        t,
      );
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

  // Histórico de auditoria do lote (hoje: romaneios gerados, com quem gerou e o operador).
  async findAuditLogs(batchId: string, params: QueryParams): Promise<PaginatedResult<AuditLog>> {
    const batch = await this.findById(batchId, { attributes: ["id"] });
    if (!batch) throw new Error("Lote não encontrado");
    return auditLogService.paginateByEntity(AuditEntity.EXPEDITION_BATCH, batchId, params);
  }

  async downloadDeliveryNotes(batchesId: string[]) {
    const batches = await this.repository.getFullBatches(batchesId);
    return batches;
  }

  // Lote de nota interna segue a mesma regra do de NF-e: só exclui vazio.
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

  // Operador do romaneio, uma vez preenchido, não muda pelo PUT /:id nem /bulk (reenviar o mesmo valor passa).
  private async assertOperatorNotChanged(
    data: Partial<ExpeditionBatch["_creationAttributes"]>,
    where: WhereOptions,
  ): Promise<void> {
    if (!("operator_id" in data)) return;

    const locked = await this.findOne({
      attributes: ["number"],
      where: {
        [Op.and]: [
          where,
          { operator_id: { [Op.ne]: null } },
          // Mandar null pra lote com operador também conta como troca.
          { operator_id: { [Op.ne]: data.operator_id ?? null } },
        ],
      },
    });
    if (locked) {
      throw new Error(
        `O operador do romaneio do lote ${locked.number} já foi definido e não pode ser alterado.`,
      );
    }
  }

  async update(
    id: string,
    data: Partial<ExpeditionBatch["_creationAttributes"]>,
    options?: Partial<UpdateOptions>,
  ) {
    await this.assertOperatorNotChanged(data, { id });
    return super.update(id, data, options);
  }

  async bulkUpdate(
    data: Partial<ExpeditionBatch["_creationAttributes"]>,
    options: UpdateOptions,
  ) {
    await this.assertOperatorNotChanged(data, options.where);
    return super.bulkUpdate(data, options);
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
