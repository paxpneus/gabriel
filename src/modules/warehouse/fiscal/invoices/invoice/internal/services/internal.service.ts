import { Op } from "sequelize";
import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import Invoice from "../../invoice.model";
import internalInvoiceRepository, {
  InternalInvoiceBranchSide,
  InternalInvoiceRepository,
} from "../repositories/internal.repository";
import { invoiceAttributesRepository, invoiceCreationService, invoiceQueryConfig } from "../../shared";
import { PaginatedResult, QueryParams } from "../../../../../../../shared/query/query.types";
import { FullInvoiceAttributes } from "../../invoice.types";
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
import sequelize from "../../../../../../../config/sequelize";
import expeditionBatchService from "../../../../../expedition/batch/batch.service";
import ExpeditionBatch from "../../../../../expedition/batch/batch.model";
import batchItemsService from "../../../../../expedition/batch-items/batch-items.service";
import batchInvoiceItemsService from "../../../../../expedition/batch-invoice-items/batch-invoice-items.service";
import scanLogsService from "../../../../../expedition/scan-logs/scan-logs.service";
import batchInvoicesService from "../../../../../expedition/batch-invoices/batch-invoices.service";
import userConfigService from "../../../../../../company/users/user_config/user_config.service";
import { FULL_ACCESS_USER_TYPES } from "../../../../../../../shared/constants/user-types";
import productService from "../../../../../../inventory/products/services/product.service";
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

    this.queryConfig = invoiceQueryConfig;
  }

  // Listagem paginada das notas internas da loja (emitidas ou recebidas por ela).
  async listInternalInvoices(
    params: QueryParams,
    unitBusinessId: string,
  ): Promise<PaginatedResult<FullInvoiceAttributes>> {
    const operationId = await invoiceOperationRepository.findIdByCode(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER);
    if (!operationId) {
      throw new Error("Operação de transferência interna não cadastrada (seed da m351)");
    }
    return this.repository.listInternalInvoices(params, unitBusinessId, operationId, this.queryConfig);
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

  // Lote só de nota interna (generate atual com a flag interna: recusa NF-e e grava is_internal).
  async generateInternalBatch(
    invoiceIds: string[],
    unitBusinessId: string,
    type: string,
    mode?: string,
  ): Promise<ExpeditionBatch> {
    return expeditionBatchService.generateBatchFromInvoices(invoiceIds, unitBusinessId, type, mode, undefined, {
      internal: true,
    });
  }

  // Adiciona notas internas (por id) a um lote interno aberto, ou cria um novo — add-invoice atual com a flag interna.
  async addInvoicesToInternalBatch(
    invoiceIds: string[],
    unitBusinessId: string,
    type: string,
    batchId?: string,
  ): Promise<ExpeditionBatch> {
    return expeditionBatchService.addInvoiceToBatch(invoiceIds, unitBusinessId, type, batchId, undefined, undefined, undefined, {
      internal: true,
    });
  }

  // Tira a nota (expedition_batch_invoice id) do lote interno — remover atual com a flag interna.
  async removeInternalBatchInvoice(batchInvoiceId: string): Promise<void> {
    return batchInvoicesService.removeBatchInvoice(batchInvoiceId, undefined, { internal: true });
  }

  // Finaliza lote interno pelo finalizar atual (conferência Tecinco pela chave composta da filial).
  async finishInternalBatch(batchId: string, justification: string, user: unknown) {
    return expeditionBatchService.finishBatch(batchId, justification, user, { internal: true });
  }

  // O que falta ler por nota no item do lote (no lugar dos volumes do XML, que a nota interna não tem).
  async findInternalBatchPending(
    batchItemId: string,
  ): Promise<Array<{ productName: string | null; invoiceNumberSystem: string | null; pendingQuantity: number }>> {
    const rows = (await batchInvoiceItemsService.findPendingByBatchItemId(batchItemId)) as any[];
    return rows.map((row) => ({
      productName: row.batchItem?.product?.name ?? null,
      invoiceNumberSystem: row.batchInvoice?.invoice?.number_system ?? null,
      pendingQuantity: Number(row.quantity_expected) - Number(row.quantity_read),
    }));
  }

  // Bipagem do lote interno só por EAN (sem etiqueta): reparte a quantidade entre as notas do lote que ainda têm o produto a ler.
  async scanInternalBatchProduct(params: {
    productCode: string;
    batchId: string;
    quantity?: number;
    userId: string;
    type: "OUTGOING" | "INCOMING";
  }): Promise<true> {
    const { productCode, batchId, userId, type } = params;
    const quantity = Number(params.quantity ?? 1);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Quantidade inválida");

    return sequelize.transaction(async (t) => {
      const batch = await expeditionBatchService.findById(batchId, {
        attributes: ["id", "unit_business_id", "type", "status", "is_internal"],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!batch) throw new Error("Lote não encontrado");
      if (!batch.is_internal) throw new Error("Lote não é de nota interna");
      if (batch.type !== type) throw new Error(`Lote não é de ${type === "OUTGOING" ? "saída" : "entrada"}`);
      if (batch.status === "FINISHED") throw new Error("Lote já finalizado");

      const found = await productService.findByCode(productCode, batch.unit_business_id, { transaction: t });
      if (!found) throw new Error("Produto não encontrado!");

      const batchItem = await batchItemsService.findOne({
        where: { expedition_batch_id: batchId, product_id: found.product.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!batchItem) throw new Error("Produto não está nas notas deste lote");

      // Uma linha por nota do lote com esse produto, na ordem de entrada no lote.
      const invoiceItems = await batchInvoiceItemsService.findAll({
        where: { expedition_batch_item_id: batchItem.id },
        // id como desempate: notas adicionadas na mesma chamada têm o mesmo createdAt e a ordem ficaria indefinida.
        order: [["createdAt", "ASC"], ["id", "ASC"]],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });

      const deltas = new Map<string, number>();
      let remaining = quantity;
      for (const item of invoiceItems) {
        if (remaining <= 0) break;
        const space = Number(item.quantity_expected) - Number(item.quantity_read);
        if (space <= 0) continue;
        const take = Math.min(remaining, space);
        deltas.set(item.expedition_batch_invoice_id, (deltas.get(item.expedition_batch_invoice_id) ?? 0) + take);
        remaining -= take;
      }
      // Saída nunca passa do esperado; entrada aceita a sobra na última nota (mesma regra do scan de entrada atual).
      if (remaining > 0) {
        if (type === "OUTGOING" || !invoiceItems.length) {
          throw new Error(`Quantidade informada (${quantity}) excede o restante a bipar (${quantity - remaining})`);
        }
        const lastId = invoiceItems[invoiceItems.length - 1].expedition_batch_invoice_id;
        deltas.set(lastId, (deltas.get(lastId) ?? 0) + remaining);
      }

      const scanLogs = [...deltas].flatMap(([batchInvoiceId, delta]) =>
        Array.from({ length: delta }, () => ({
          expedition_batch_id: batchId,
          expedition_batch_items_id: batchItem.id,
          expedition_batch_invoices_id: batchInvoiceId,
          label_full_code: productCode,
          vol_number: "000000",
          user_id: userId,
        })),
      );
      await scanLogsService.bulkCreate(scanLogs as any, { transaction: t });
      // Mesma transação: o Sequelize serializa as queries na conexão dela.
      await Promise.all(
        [...deltas].map(([batchInvoiceId, delta]) =>
          scanLogsService.syncFromScanning(batchId, batchItem.id, batchInvoiceId, delta, t),
        ),
      );
      return true as const;
    });
  }

  // Edita a quantidade lida de um produto numa nota do lote interno (delta com sinal, sem scan log), só admin/developer; mesma regra do by-invoice dos lotes atuais.
  async adjustInternalBatchQuantity(params: {
    batchId: string;
    invoiceId: string;
    productId: string;
    quantity: number;
    userId: string;
    type: "OUTGOING" | "INCOMING";
  }): Promise<true> {
    const { batchId, invoiceId, productId, userId, type } = params;
    const quantity = Number(params.quantity);
    if (!Number.isInteger(quantity) || quantity === 0) throw new Error("Quantidade inválida");
    if (!batchId || !invoiceId || !productId) throw new Error("Informe lote, nota e produto");

    const config = await userConfigService.findOne({ where: { user_id: userId }, attributes: ["type"] });
    if (!config || !FULL_ACCESS_USER_TYPES.includes(config.type)) {
      throw new Error("Apenas administradores podem executar esta ação");
    }

    return sequelize.transaction(async (t) => {
      const batch = await expeditionBatchService.findById(batchId, {
        attributes: ["id", "type", "status", "is_internal"],
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!batch) throw new Error("Lote não encontrado");
      if (!batch.is_internal) throw new Error("Lote não é de nota interna");
      if (batch.type !== type) throw new Error(`Lote não é de ${type === "OUTGOING" ? "saída" : "entrada"}`);
      if (batch.status === "FINISHED") throw new Error("Lote já finalizado");

      const batchItem = await batchItemsService.findOne({
        where: { expedition_batch_id: batchId, product_id: productId },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!batchItem) throw new Error("Produto não está nas notas deste lote");

      const batchInvoice = await batchInvoicesService.findOne({
        where: { expedition_batch_id: batchId, invoice_id: invoiceId },
        attributes: ["id"],
        transaction: t,
      });
      if (!batchInvoice) throw new Error("Nota não encontrada no lote");

      const invoiceItem = await batchInvoiceItemsService.findOne({
        where: { expedition_batch_item_id: batchItem.id, expedition_batch_invoice_id: batchInvoice.id },
        transaction: t,
        lock: t.LOCK.UPDATE,
      });
      if (!invoiceItem) throw new Error("Nota não contém este produto");

      // Limite por nota: nunca abaixo de zero; saída também não passa do esperado (entrada aceita sobra, como o scan).
      const next = Number(invoiceItem.quantity_read) + quantity;
      if (next < 0) {
        throw new Error(`Quantidade a subtrair (${Math.abs(quantity)}) maior que o já bipado (${invoiceItem.quantity_read})`);
      }
      if (type === "OUTGOING" && next > Number(invoiceItem.quantity_expected)) {
        throw new Error(
          `Quantidade informada (${quantity}) excede o restante a bipar (${Number(invoiceItem.quantity_expected) - Number(invoiceItem.quantity_read)})`,
        );
      }

      await scanLogsService.syncFromScanning(batchId, batchItem.id, batchInvoice.id, quantity, t);
      return true as const;
    });
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
