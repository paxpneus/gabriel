import { Transaction, UpdateOptions, WhereOptions } from "sequelize";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../../../../shared/query/query.types";
import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import Invoice from "../../invoice.model";
import invoiceRepository, { InvoiceRepository } from "../repositories/invoice.repository";
import {
  FullInvoiceAttributes,
  InvoiceAttributes,
} from "../../invoice.types";
import { PendingBatchByTransporterRow } from "../types/core.types";
import { InvoiceUnitBusinessAttributesStatus } from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import {
  InvoiceViewPoint,
  InvoiceViewPointContext,
  InvoiceViewPointParties,
  resolveInvoiceViewPoint,
} from "../helpers/view-point";
import {
  internalInvoiceScopeService,
  invoiceAttributesRepository,
  invoiceQueryConfig,
  invoiceXmlRepository,
  readNfeIde,
  splitTransferLinkWrite,
  TransferLinkActor,
  transferReferenceService,
} from "../../shared";
import pdvSalesRequestService from "../../../../../../sales/pdv-management/sales-request/pdv-sales-request.service";
import { PdvSalesRequestStatus } from "../../../../../../sales/pdv-management/sales-request/pdv-sales-request.types";
import roleService from "../../../../../../company/users/roles/role.service";
import { AuditOrigin } from "../../../../../../global/audit-logs/audit-log.types";
import { cleanDocument } from "../../../../../../../shared/utils/normalizers/document";
import unitBusinessService from "../../../../../../company/unit-business/unit-business.service";
import auditLogService from "../../../../../../global/audit-logs/audit-log.service";
import AuditLog from "../../../../../../global/audit-logs/audit-log.model";
import { AuditEntity } from "../../../../../../global/audit-logs/audit-log.types";

const default_seller = "5ff76374-4d67-4ef3-a566-349a015f86b1";

// CRUD, listagens e detalhe da nota fiscal; usa o queryConfig compartilhado do shared.
// Escrita interna sem usuário (scan, fluxos automáticos) que porventura mexa no vínculo de transferência.
const SYSTEM_TRANSFER_LINK_ACTOR: TransferLinkActor = { userId: null, origin: AuditOrigin.SYSTEM };

export class InvoiceService extends BaseService<Invoice, InvoiceRepository> {
  constructor() {
    super(invoiceRepository);

    this.queryConfig = invoiceQueryConfig;
  }

  async listInvoicesPendingLogisticOccurrence(): Promise<Invoice[]> {
    return this.repository.findInvoicesPendingLogisticOccurrence();
  }

  async findByIdFull(id: string, unitBusinessId: string) {
    return this.repository.getFullInvoice(id, unitBusinessId);
  }

  async findByIdFullWithBatch(
    id: string,
    unitBusinessId: string,
    type?: "INCOMING" | "OUTGOING",
    roleId?: string | null,
  ) {
    const invoice = await this.repository.getFullInvoiceWithBatch(id, unitBusinessId, type);
    const [[withViewPoint], transferInvoiceEdit] = await Promise.all([
      this.withViewPoints([invoice], unitBusinessId),
      this.resolveTransferInvoiceEdit(invoice, roleId),
    ]);
    return { ...withViewPoint!, ...transferInvoiceEdit };
  }

  // Front: pode vincular/trocar/remover a transferência pela tela da nota? Mesmas regras do setTransferInvoice (nota interna não;
  // solicitação do PDV só da etapa da transferência pra frente; finalizada na emitente ou solicitação FINISHED só admin).
  private async resolveTransferInvoiceEdit(
    invoice: { id: string; invoice_operation_id?: string | null },
    roleId?: string | null,
  ): Promise<{ can_edit_transfer_invoice: boolean; transfer_invoice_edit_blocked_reason: string | null }> {
    const [internalOperationId, finishedAtSender, [request]] = await Promise.all([
      internalInvoiceScopeService.getInternalOperationId(),
      transferReferenceService.isFinishedAtSender(invoice.id),
      pdvSalesRequestService.findTransferLinkableBySaleInvoiceIds([invoice.id]),
    ]);
    let reason: string | null = null;
    if (internalOperationId && invoice.invoice_operation_id === internalOperationId) {
      reason = "Nota interna não tem nota de transferência.";
    } else if (request && pdvSalesRequestService.transferInvoiceFlowBlockedReason(request)) {
      reason = pdvSalesRequestService.transferInvoiceFlowBlockedReason(request);
    } else if (finishedAtSender || request?.status === PdvSalesRequestStatus.FINISHED) {
      // Role só é consultada quando a nota está finalizada.
      const isAdmin = !!roleId && (await roleService.isAdminRole(roleId));
      if (!isAdmin) reason = "Nota de venda finalizada: só administradores podem alterar a nota de transferência.";
    }
    return { can_edit_transfer_invoice: !reason, transfer_invoice_edit_blocked_reason: reason };
  }

  // GET /:id (show do BaseController) com as flags de view point.
  async findByIdWithViewPoint(id: string, unitBusinessId: string) {
    const invoice = await this.findById(id);
    if (!invoice) return null;
    const plain = invoice.get({ plain: true }) as InvoiceAttributes;
    const [withViewPoint] = await this.withViewPoints(
      [{ ...plain, xml_head: plain.xml_path }],
      unitBusinessId,
    );
    return withViewPoint!;
  }

  // Uma query só pras lojas: CNPJs de todas (transferência/venda) + o da loja que está vendo (direção).
  private async buildViewPointContext(
    unitBusinessId?: string,
  ): Promise<InvoiceViewPointContext> {
    const unitBusinesses = await unitBusinessService.findAll({
      attributes: ["id", "cnpj"],
    });
    const cnpjOf = (ub: { cnpj?: string | null }) =>
      ub.cnpj ? cleanDocument(ub.cnpj) : null;
    const viewer = unitBusinessId
      ? unitBusinesses.find((ub) => ub.id === unitBusinessId)
      : undefined;
    return {
      viewerCnpj: viewer ? cnpjOf(viewer) : null,
      unitBusinessCnpjs: new Set(
        unitBusinesses.map(cnpjOf).filter((cnpj): cnpj is string => !!cnpj),
      ),
    };
  }

  // Lê o <ide> do início do XML (xml_head); nota rara com <ide> além do trecho busca o XML inteiro, numa query só.
  // Falha aqui nunca derruba a rota: flags vêm null e a nota sai igual.
  private async withViewPoints<
    T extends InvoiceViewPointParties & { id: string; xml_head?: string | null },
  >(
    invoices: T[],
    unitBusinessId?: string,
  ): Promise<(Omit<T, "xml_head"> & InvoiceViewPoint)[]> {
    try {
      const ides = new Map(
        invoices.map((invoice) => [invoice.id, readNfeIde(invoice.xml_head)]),
      );
      const truncatedIds = invoices
        .filter((invoice) => invoice.xml_head && !ides.get(invoice.id))
        .map((invoice) => invoice.id);

      const [context, fullXmls] = await Promise.all([
        this.buildViewPointContext(unitBusinessId),
        truncatedIds.length
          ? invoiceXmlRepository.findXmlPathsByIds(truncatedIds)
          : Promise.resolve([]),
      ]);
      fullXmls.forEach((row) => ides.set(row.id, readNfeIde(row.xml_path)));

      return invoices.map(({ xml_head, ...invoice }) => ({
        ...invoice,
        ...resolveInvoiceViewPoint(invoice, ides.get(invoice.id) ?? null, context),
      }));
    } catch (err) {
      console.warn("[INVOICE VIEW POINT] Falha ao calcular flags:", err);
      return invoices.map(({ xml_head, ...invoice }) => ({
        ...invoice,
        view_point_type: null,
        view_point_direction: null,
      }));
    }
  }

  async findByIdFullForAllUnits(
    id?: string,
    xml_key?: string,
    id_system?: string,
  ) {
    return this.repository.getFullInvoiceForAllUnits(id, xml_key, id_system);
  }

  async listInvoices(
    params: QueryParams,
    unitBusinessId: string,
  ): Promise<PaginatedResult<FullInvoiceAttributes>> {
    return this.repository.listInvoices(
      params,
      unitBusinessId,
      this.queryConfig,
    );
  }

  // Mesma listagem paginada de `listInvoices`, restrita a notas de
  // transferência (remetente E destinatário são ambos unit_businesses
  // próprias). `unitBusinessId` é opcional — o front decide se filtra por
  // uma loja específica; sem ele, lista transferências de todas.
  async listTransferInvoices(
    params: QueryParams,
    unitBusinessId?: string,
  ): Promise<PaginatedResult<FullInvoiceAttributes>> {
    return this.repository.listTransferInvoices(
      params,
      unitBusinessId,
      this.queryConfig,
    );
  }

  // Update genérico da nota + atributos da unit business (PUT /:id, lote, scan); vínculo de transferência vai por setTransferInvoice.
  async updateInvoices(
    invoiceIds: string[],
    unitBusinessId: string,
    data: Partial<
      InvoiceAttributes & {
        status: InvoiceUnitBusinessAttributesStatus;
        batch_generated: boolean;
      }
    >,
    attrWhere?: WhereOptions,
    transaction?: Transaction,
    actor: TransferLinkActor = SYSTEM_TRANSFER_LINK_ACTOR,
  ): Promise<void> {
    const { transferInvoiceId, rest } = splitTransferLinkWrite(data);
    if (transferInvoiceId !== undefined) {
      await this.setTransferInvoice(invoiceIds, transferInvoiceId, actor, transaction);
    }
    return invoiceAttributesRepository.updateWithAttributes(
      invoiceIds,
      unitBusinessId,
      rest,
      attrWhere,
      transaction,
    );
  }

  // PUT /bulk genérico: vínculo de transferência pelo mesmo setTransferInvoice do updateInvoices.
  async bulkUpdate(
    data: Partial<Invoice["_creationAttributes"]>,
    options: UpdateOptions,
    actor: TransferLinkActor = SYSTEM_TRANSFER_LINK_ACTOR,
  ) {
    // PUT /bulk: nota interna só pelos fluxos de internal/.
    await internalInvoiceScopeService.assertNotInternalInvoices(options.where, options.transaction ?? undefined);
    const { transferInvoiceId, rest } = splitTransferLinkWrite(data);
    if (transferInvoiceId !== undefined) {
      const targets = await this.findAll({ where: options.where, attributes: ["id"], transaction: options.transaction });
      await this.setTransferInvoice(
        targets.map((invoice) => invoice.id),
        transferInvoiceId,
        actor,
        options.transaction ?? undefined,
      );
    }
    return super.bulkUpdate(rest, options);
  }

  // Vínculo de transferência pelo fluxo comum (tela da nota, bulk, lote): nota de venda com solicitação no PDV vai pelo PDV
  // (etapa, status e sincronia da solicitação); as outras gravam direto, na transação do chamador.
  async setTransferInvoice(
    invoiceIds: string[],
    transferInvoiceId: string | null,
    actor: TransferLinkActor,
    transaction?: Transaction,
  ): Promise<void> {
    const requests = await pdvSalesRequestService.findTransferLinkableBySaleInvoiceIds(invoiceIds);
    const viaPdv = new Set(requests.map((request) => request.sale_invoice_id));
    await Promise.all(
      requests.map((request) => pdvSalesRequestService.setTransferInvoiceFromInvoiceFlow(request, transferInvoiceId, actor)),
    );
    const direct = invoiceIds.filter((id) => !viaPdv.has(id));
    if (direct.length) await transferReferenceService.linkTransferInvoice(direct, transferInvoiceId, actor, transaction);
  }

  async findDeliveryNoteGeneratedInvoiceIds(
    invoiceIds: string[],
    unitBusinessId: string,
  ): Promise<string[]> {
    return this.repository.findDeliveryNoteGeneratedInvoiceIds(
      invoiceIds,
      unitBusinessId,
    );
  }

  // Histórico de auditoria da nota (hoje: carta de correção anexada).
  async findAuditLogs(invoiceId: string, params: QueryParams): Promise<PaginatedResult<AuditLog>> {
    const invoice = await this.findById(invoiceId, { attributes: ["id"] });
    if (!invoice) throw new Error("Nota fiscal não encontrada");
    return auditLogService.paginateByEntity(AuditEntity.INVOICE, invoiceId, params);
  }

  async getPendingBatchByTransporter(
    unitBusinessId: string,
  ): Promise<PendingBatchByTransporterRow[]> {
    return this.repository.countPendingBatchByTransporter(unitBusinessId);
  }
}

export default new InvoiceService();
