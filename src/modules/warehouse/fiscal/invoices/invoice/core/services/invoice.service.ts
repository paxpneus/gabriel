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
  invoiceAttributesRepository,
  invoiceQueryConfig,
  invoiceXmlRepository,
  readNfeIde,
  transferReferenceService,
} from "../../shared";
import { cleanDocument } from "../../../../../../../shared/utils/normalizers/document";
import unitBusinessService from "../../../../../../company/unit-business/unit-business.service";
import auditLogService from "../../../../../../global/audit-logs/audit-log.service";
import AuditLog from "../../../../../../global/audit-logs/audit-log.model";
import { AuditEntity } from "../../../../../../global/audit-logs/audit-log.types";

const default_seller = "5ff76374-4d67-4ef3-a566-349a015f86b1";

// CRUD, listagens e detalhe da nota fiscal; usa o queryConfig compartilhado do shared.
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
  ) {
    const invoice = await this.repository.getFullInvoiceWithBatch(
      id,
      unitBusinessId,
      type,
    );
    const [withViewPoint] = await this.withViewPoints([invoice], unitBusinessId);
    return withViewPoint!;
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

  // Update genérico da nota + atributos da unit business (PUT /:id, lote, scan), com a mesma validação de referência de transferência.
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
  ): Promise<void> {
    await transferReferenceService.assertTransferReferenceWrite(data, { id: invoiceIds }, transaction);
    return invoiceAttributesRepository.updateWithAttributes(
      invoiceIds,
      unitBusinessId,
      data,
      attrWhere,
      transaction,
    );
  }

  // PUT /bulk genérico: mesma validação de transfer_invoice_reference do updateInvoices.
  async bulkUpdate(data: Partial<Invoice["_creationAttributes"]>, options: UpdateOptions) {
    await transferReferenceService.assertTransferReferenceWrite(data, options.where, options.transaction ?? undefined);
    return super.bulkUpdate(data, options);
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
