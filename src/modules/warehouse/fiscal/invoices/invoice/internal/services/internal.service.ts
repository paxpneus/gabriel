import { Op } from "sequelize";
import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import Invoice from "../../invoice.model";
import internalInvoiceRepository, {
  InternalInvoiceBranchSide,
  InternalInvoiceRepository,
} from "../repositories/internal.repository";
import { invoiceAttributesRepository, invoiceCreationService } from "../../shared";
import invoiceOperationRepository from "../../../invoice-operation/invoice-operation.repository";
import { INVOICE_OPERATION_CODES } from "../../../invoice-operation/invoice-operation.types";
import { InvoiceUnitBusinessAttributesStatus } from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import { UnmappedInvoiceProductCreationAttributes } from "../../../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.types";
import unmappedInvoiceProductService from "../../../../../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
import storeService from "../../../../../../sales/stores/stores.service";
import transporterService from "../../../../../transporter/transporter.service";
import type { TCarNotaFiscalDetail } from "../../../../../../handlers/tecinco/service/tecinco/tecinco.types";
import type {
  InvoiceOperationalItemFromXml,
  UnmappedInvoiceItemFromXml,
} from "../../../../../../../shared/utils/xml/invoice-xml";
import { buildInternalInvoiceIdSystem } from "../helpers/internal-invoice-id";
import { buildInternalInvoiceItems } from "../helpers/internal-fiscal-items";

export interface InternalInvoiceParty {
  cnpj: string;
  name: string;
}

export interface UpsertInternalInvoiceParams {
  // Detalhe Tecinco pela chave composta (vira o source_payload).
  detail: TCarNotaFiscalDetail;
  numero: string;
  // Lado da filial que listou a nota: OUTGOING = S (emitente), INCOMING = E (destinatária).
  invoiceType: "INCOMING" | "OUTGOING";
  sender: InternalInvoiceParty;
  receiver: InternalInvoiceParty;
  integrationsId: string;
  operationalItems: InvoiceOperationalItemFromXml[];
  unmappedItems: UnmappedInvoiceItemFromXml[];
  cancelled: boolean;
}

// Nota interna (série B da Tecinco, sem chave nem XML): gravação e dedup do sync.
export class InternalInvoiceService extends BaseService<Invoice, InternalInvoiceRepository> {
  constructor() {
    super(internalInvoiceRepository);
  }

  // Números já gravados como nota interna com a filial no lado da listagem (dedup do sync); sem a operação no banco, não deduplica.
  async findExistingInternalNumbers(
    side: InternalInvoiceBranchSide,
    branchCnpj: string,
    numbers: string[],
  ): Promise<string[]> {
    const operationId = await invoiceOperationRepository.findIdByCode(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER);
    if (!operationId) return [];
    return this.repository.findExistingInternalNumbers(operationId, side, branchCnpj, numbers);
  }

  // Notas internas da lista que ainda não estão CANCELLED em alguma das unit businesses (cancelamento do sync).
  async findInternalNumbersNotCancelledInUnitBusinesses(
    side: InternalInvoiceBranchSide,
    branchCnpj: string,
    numbers: string[],
    unitBusinessNumbers: string[],
  ): Promise<string[]> {
    const operationId = await invoiceOperationRepository.findIdByCode(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER);
    if (!operationId) return [];
    return this.repository.findInternalNumbersNotCancelledInUnitBusinesses(
      operationId,
      side,
      branchCnpj,
      numbers,
      unitBusinessNumbers,
    );
  }

  // Cria ou atualiza a nota interna pelo id_system canônico (S e E da mesma transferência caem na mesma linha); devolve o id.
  async upsertInternalInvoice(params: UpsertInternalInvoiceParams): Promise<string> {
    const { detail, numero, invoiceType, sender, receiver, integrationsId, cancelled } = params;

    // Sem a operação a nota interna vazaria pras listagens de NF-e (filtro por invoice_operation_id).
    const operationId = await invoiceOperationRepository.findIdByCode(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER);
    if (!operationId) {
      throw new Error("Operação de transferência interna não cadastrada (seed da m351) — nota interna não gravada");
    }

    const idSystem = buildInternalInvoiceIdSystem(sender.cnpj, numero);
    // Sem documento o resolveTransporter devolve o placeholder "Sem transporte".
    const [existing, transporter] = await Promise.all([
      this.repository.findIdByIdSystem(idSystem),
      transporterService.resolveTransporter({ document: null, integrationsId }),
    ]);

    // Mesma regra do invoice-xml.ts: cancelada → CANCELLED; saída → OPEN; entrada → aguarda agendamento.
    let initialStatus: InvoiceUnitBusinessAttributesStatus = "WAITING_SCHEDULE_SALES";
    if (cancelled) {
      initialStatus = "CANCELLED";
    } else if (invoiceType === "OUTGOING") {
      initialStatus = "OPEN";
    }

    const totals = detail.totais ?? {};
    // emissao vem só a data (YYYY-MM-DD): meia-noite de Brasília, não UTC.
    let emittedAt = new Date();
    if (detail.cabecalho?.emissao) {
      emittedAt = new Date(`${detail.cabecalho.emissao}T00:00:00-03:00`);
    }
    const invoiceBaseData = {
      customer_name: receiver.name,
      customer_document: receiver.cnpj,
      sender_cnpj: sender.cnpj,
      sender_name: sender.name,
      receiver_cnpj: receiver.cnpj,
      receiver_name: receiver.name,
      xml_path: null,
      xml_key: null,
      emitted_at: emittedAt,
      number_system: numero,
      invoice_series: detail.chave?.serie ?? null,
      integrations_id: integrationsId,
      invoice_operation_id: operationId,
      transporter_id: transporter?.id ?? null,
      transporter_document: transporter?.cnpj ?? null,
      transporter_name: transporter?.name ?? null,
      invoice_value: Number(totals.valor_nota ?? 0),
      invoice_products_value: Number(totals.valor_produtos ?? 0),
      invoice_freight_value: Number(totals.valor_frete ?? 0),
      invoice_discount_value: Number(totals.valor_desconto ?? 0),
      ipi_value: Number(totals.valor_ipi ?? 0),
      source_payload: detail as unknown as Record<string, unknown>,
    };
    const items = buildInternalInvoiceItems(params.operationalItems, detail.itens ?? []);

    let invoiceId: string;
    if (!existing) {
      const defaultStore = await storeService.findOne({ where: { name: "Outros" }, attributes: ["id"] });
      if (!defaultStore) {
        throw new Error('Loja padrão "Outros" não cadastrada — não é possível criar a nota interna');
      }
      const created = await invoiceCreationService.createWithRelations(
        { ...invoiceBaseData, id_system: idSystem, store_id: defaultStore.id, danfe_path: null },
        items,
        { initialStatus, invoiceType },
      );
      invoiceId = created.id;
    } else {
      // Mesma sequência do update do invoice-xml.ts: dados da nota, attributes faltantes, itens faltantes.
      await invoiceAttributesRepository.updateWithAttributesForAllUnits([existing.id], invoiceBaseData);
      await invoiceCreationService.ensureUnitBusinessAttributes(existing.id, {
        senderCnpj: sender.cnpj,
        receiverCnpj: receiver.cnpj,
        initialStatus,
        invoiceType,
      });
      await invoiceCreationService.addMissingInvoiceItems(existing.id, items);
      invoiceId = existing.id;
    }

    await this.syncUnmappedProducts(invoiceId, integrationsId, params.unmappedItems);
    console.log(`[INTERNAL_INVOICE] Nota interna upsertada: id_system=${idSystem}`);
    return invoiceId;
  }

  // Reconcilia os não mapeados da nota com esta passagem (regra do invoice-xml.ts, em lote): UNMAPPED que sumiu é apagado, o resto criado/atualizado.
  private async syncUnmappedProducts(
    invoiceId: string,
    integrationsId: string,
    unmappedItems: UnmappedInvoiceItemFromXml[],
  ): Promise<void> {
    const keyOf = (ean?: string | null, sku?: string | null) => (ean ? `ean:${ean}` : `sku:${sku ?? ""}`);
    const current = new Map(unmappedItems.map((item) => [keyOf(item.gtin, item.sku), item]));
    const existing = await unmappedInvoiceProductService.findAll({
      where: { invoice_id: invoiceId },
      attributes: ["id", "ean", "sku", "status"],
    });
    const existingByKey = new Map(existing.map((row) => [keyOf(row.ean, row.sku), row]));

    const obsoleteIds = existing
      .filter((row) => row.status === "UNMAPPED" && !current.has(keyOf(row.ean, row.sku)))
      .map((row) => row.id);
    const toCreate: UnmappedInvoiceProductCreationAttributes[] = [];
    const writes: Promise<unknown>[] = [];

    for (const [key, item] of current) {
      const quantity = Math.trunc(Number(item.qty ?? 0)) || 0;
      const row = existingByKey.get(key);
      if (row) {
        writes.push(
          unmappedInvoiceProductService.update(row.id, {
            quantity,
            integrations_id: integrationsId,
            external_id: item.external_id ?? null,
            type: item.type ?? "ERROR_INVOICE",
          }),
        );
        continue;
      }
      toCreate.push({
        invoice_id: invoiceId,
        integrations_id: integrationsId,
        ean: item.gtin ?? null,
        sku: item.sku ?? null,
        external_id: item.external_id ?? null,
        product_name: item.xProd,
        quantity,
        reason: item.reason,
        type: item.type ?? "ERROR_INVOICE",
        status: "UNMAPPED",
      });
    }

    if (obsoleteIds.length) {
      writes.push(unmappedInvoiceProductService.bulkDelete({ where: { id: { [Op.in]: obsoleteIds } } }));
    }
    if (toCreate.length) {
      writes.push(unmappedInvoiceProductService.bulkCreate(toCreate));
    }
    await Promise.all(writes);

    if (current.size) {
      console.warn(`[INTERNAL_INVOICE] ${current.size} produto(s) não mapeado(s) na nota ${invoiceId}`);
    }
  }
}

export default new InternalInvoiceService();
