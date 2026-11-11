import { Transaction } from "sequelize";
import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import Invoice from "../../invoice.model";
import sequelize from "../../../../../../../config/sequelize";
import eventService from "../../../../../../company/events/event/event.service";
import { InvoiceCreationData, ItemWithFiscal } from "../../invoice.types";
import { InvoiceUnitBusinessAttributesCreationAttributes, InvoiceUnitBusinessAttributesStatus } from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import { InvoiceFiscalItemCreationAttributes } from "../../../invoice-fiscal-item/invoice-fiscal-item.types";
import invoiceCreationRepository, { InvoiceCreationRepository } from "../repositories/invoice-creation.repository";
import invoiceAttributesRepository from "../repositories/invoice-attributes.repository";
import invoiceItemsRepository from "../../../invoice-items/invoice-items.repository";
import invoiceFiscalItemRepository from "../../../invoice-fiscal-item/invoice-fiscal-item.repository";
import invoiceUnitBusinessAttributesRepository from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.repository";

// Criação de nota com itens/attributes e reprocesso de itens/attributes faltantes, usada por ingestão e integrações.
export class InvoiceCreationService extends BaseService<Invoice, InvoiceCreationRepository> {
  constructor() {
    super(invoiceCreationRepository);
  }

  async createWithRelations(
    invoiceData: InvoiceCreationData,
    items: ItemWithFiscal[],
    {
      transaction,
      initialStatus = "OPEN",
      invoiceType,
    }: {
      transaction?: Transaction;
      initialStatus?: InvoiceUnitBusinessAttributesStatus;
      mainUnitBusinessId?: string;
      invoiceType?: "INCOMING" | "OUTGOING";
    } = {},
  ): Promise<Invoice> {
    const t = transaction ?? (await sequelize.transaction());
    const isExternalTransaction = !!transaction;

    try {
      // ─── 1. Resolve unit businesses ──────────────────────────────────────
      const unitBusinesses = await invoiceAttributesRepository.findUnitBusinessesByCnpj(
        [invoiceData.sender_cnpj, invoiceData.receiver_cnpj].filter(
          Boolean,
        ) as string[],
        t,
      );

      const cnpjMap = new Map(unitBusinesses.map((ub) => [ub.cnpj, ub.id]));
      const senderUbId = cnpjMap.get(invoiceData.sender_cnpj);
      const receiverUbId = cnpjMap.get(invoiceData.receiver_cnpj);

      // ─── 2. Cria a invoice ───────────────────────────────────────────────
      const invoice = await this.repository.createInvoice(
        { ...invoiceData },
        t,
      );

      // ─── 3. Cria items e fiscal items ─────────────────────
      const deduplicatedItems = items.reduce<ItemWithFiscal[]>((acc, item) => {
        const existing = acc.find((i) => i.product_id === item.product_id);
        if (existing) {
          existing.quantity_expected = Math.trunc(
            existing.quantity_expected + item.quantity_expected,
          );
        } else {
          acc.push({ ...item });
        }
        return acc;
      }, []);

      const invoiceItems = deduplicatedItems.map(
        ({ fiscal: _, ...itemData }) => ({
          ...itemData,
          invoice_id: invoice.id,
        }),
      );

      await invoiceItemsRepository.createInvoiceItems(invoiceItems, t);

      const fiscalItems = deduplicatedItems
        .map(({ fiscal, ...itemData }, index) =>
          fiscal
            ? {
                ...fiscal,
                invoice_id: invoice.id,
                item_number: fiscal.item_number ?? index + 1,
              }
            : null,
        )
        .filter(Boolean) as InvoiceFiscalItemCreationAttributes[];

      if (fiscalItems.length > 0) {
        await invoiceFiscalItemRepository.createInvoiceFiscalItems(fiscalItems, t);
      }

      // ─── 4. Resolve attributes por cnpj ──────────────────────────────────
      const seen = new Set<string>();
      const attributes: InvoiceUnitBusinessAttributesCreationAttributes[] = [];

      const addAttr = (
        unitBusinessId: string,
        type: "INCOMING" | "OUTGOING",
        status: InvoiceUnitBusinessAttributesStatus,
      ) => {
        const key = `${invoice.id}:${unitBusinessId}`;
        if (seen.has(key)) return;
        seen.add(key);
        attributes.push({
          invoice_id: invoice.id,
          unit_business_id: unitBusinessId,
          type,
          status,
          batch_generated: false,
        });
      };

      if (senderUbId && receiverUbId) {
        addAttr(senderUbId, "OUTGOING", "OPEN");
        addAttr(receiverUbId, "INCOMING", initialStatus ?? "OPEN");
      } else if (senderUbId) {
        addAttr(senderUbId, invoiceType ?? "OUTGOING", initialStatus ?? "OPEN");
      } else if (receiverUbId) {
        addAttr(
          receiverUbId,
          invoiceType ?? "INCOMING",
          initialStatus ?? "OPEN",
        );
      }

      if (attributes.length > 0) {
        await invoiceUnitBusinessAttributesRepository.createInvoiceAttributes(attributes, t);
      }

      // ─── 5. Notifica operadores e admins

      const incomingUbId =
        receiverUbId ??
        (senderUbId && invoiceType === "INCOMING" ? senderUbId : undefined);

      if (incomingUbId) {
        await eventService.notifyByRoles({
          types: ["operator", "admin"],
          unitBusinessId: incomingUbId,
          title: "Nova nota fiscal recebida",
          description: `Nota ${invoice.number_system} foi recebida e aguarda agendamento.`,
          transaction: t,
        });
      }

      if (!isExternalTransaction) await t.commit();

      return invoice;
    } catch (err) {
      if (!isExternalTransaction) await t.rollback();
      throw err;
    }
  }

  /**
   * Cria os InvoiceItems (+ InvoiceFiscalItem) que ainda não existem numa
   * invoice JÁ existente — usado no reprocesso de itens que ficaram
   * "não mapeados" na primeira passagem e só resolveram a um Product depois
   * (ex.: alguém concilia o produto no Bling e o webhook reenvia a nota).
   * Ignora silenciosamente qualquer item cujo product_id já tenha um
   * InvoiceItems OU InvoiceFiscalItem pra essa invoice — duas notas Tecinco
   * podem legitimamente resolver códigos internos diferentes pro mesmo
   * product_id (auto-map por SKU/EAN), então checar só InvoiceItems deixava
   * passar um product_id que já tinha InvoiceFiscalItem (ex.: de uma
   * passagem anterior que falhou depois de criar o fiscal item mas antes de
   * concluir), estourando a constraint única (invoice_id, product_id) no
   * insert em vez de ser ignorado aqui.
   * Retorna os product_id efetivamente criados.
   */
  async addMissingInvoiceItems(
    invoiceId: string,
    items: ItemWithFiscal[],
    transaction?: Transaction,
  ): Promise<string[]> {
    if (!items.length) return [];

    const t = transaction ?? (await sequelize.transaction());
    const isExternalTransaction = !!transaction;

    try {
      const productIds = items.map((i) => i.product_id);
      const [existingItems, existingFiscalItems] = await Promise.all([
        invoiceItemsRepository.findByInvoiceId(invoiceId, productIds, t),
        invoiceFiscalItemRepository.findByInvoiceId(invoiceId, productIds, t),
      ]);
      const existingProductIds = new Set([
        ...existingItems.map((i) => i.product_id),
        ...existingFiscalItems.map((i) => i.product_id),
      ]);

      const newItems = items
        .filter((item) => !existingProductIds.has(item.product_id))
        .reduce<ItemWithFiscal[]>((acc, item) => {
          const dup = acc.find((i) => i.product_id === item.product_id);
          if (dup) {
            dup.quantity_expected = Math.trunc(
              dup.quantity_expected + item.quantity_expected,
            );
          } else {
            acc.push({ ...item });
          }
          return acc;
        }, []);

      if (!newItems.length) {
        if (!isExternalTransaction) await t.commit();
        return [];
      }

      const invoiceItems = newItems.map(({ fiscal: _, ...itemData }) => ({
        ...itemData,
        invoice_id: invoiceId,
      }));
      await invoiceItemsRepository.createInvoiceItems(invoiceItems, t);

      const fiscalItems = newItems
        .map(({ fiscal, ...itemData }, index) =>
          fiscal
            ? {
                ...fiscal,
                invoice_id: invoiceId,
                item_number: fiscal.item_number ?? index + 1,
              }
            : null,
        )
        .filter(Boolean) as InvoiceFiscalItemCreationAttributes[];
      if (fiscalItems.length > 0) {
        await invoiceFiscalItemRepository.createInvoiceFiscalItems(fiscalItems, t);
      }

      if (!isExternalTransaction) await t.commit();
      return newItems.map((i) => i.product_id);
    } catch (err) {
      if (!isExternalTransaction) await t.rollback();
      throw err;
    }
  }

  // Backfill de InvoiceUnitBusinessAttributes pra uma invoice que JÁ existe
  // mas nunca passou por createWithRelations — hoje só acontece com uma nota
  // "provisória" (createStub) sendo enriquecida depois pelo upsert real
  // (Tecinco/Bling), que sempre cai no branch de UPDATE (a linha já existe,
  // achada por xml_key/id_system) e NUNCA cria attributes (só o branch de
  // CREATE faz isso). Sem isso, a nota nunca aparece em nenhuma tela/filtro
  // que dependa de unitBusinessAttributes.status, mesmo depois de totalmente
  // enriquecida. Chamado por invoice-xml.ts/bling-api-fetch.queue.ts logo
  // após updateInvoicesForAllUnitBusiness, com o sender_cnpj/receiver_cnpj já
  // resolvidos por esse upsert. Idempotente — nunca duplica uma linha já
  // existente (checa por invoice_id+unit_business_id antes de criar), então é
  // seguro chamar em toda nota, não só nas provisórias.
  async ensureUnitBusinessAttributes(
    invoiceId: string,
    params: {
      senderCnpj?: string | null;
      receiverCnpj?: string | null;
      initialStatus?: InvoiceUnitBusinessAttributesStatus;
      invoiceType?: "INCOMING" | "OUTGOING";
      transaction?: Transaction;
    },
  ): Promise<void> {
    const {
      senderCnpj,
      receiverCnpj,
      initialStatus = "OPEN",
      invoiceType,
      transaction,
    } = params;

    const cnpjs = [senderCnpj, receiverCnpj].filter(Boolean) as string[];
    if (cnpjs.length === 0) return;

    const unitBusinesses = await invoiceAttributesRepository.findUnitBusinessesByCnpj(
      cnpjs,
      transaction,
    );
    const cnpjMap = new Map(unitBusinesses.map((ub) => [ub.cnpj, ub.id]));
    const senderUbId = senderCnpj ? cnpjMap.get(senderCnpj) : undefined;
    const receiverUbId = receiverCnpj ? cnpjMap.get(receiverCnpj) : undefined;

    const toCreate: InvoiceUnitBusinessAttributesCreationAttributes[] = [];
    // Sender e receiver podem ser a mesma unit business (mesmo CNPJ); a unique é (invoice_id, unit_business_id).
    const queued = new Set<string>();

    const maybeAdd = async (
      unitBusinessId: string | undefined,
      type: "INCOMING" | "OUTGOING",
      status: InvoiceUnitBusinessAttributesStatus,
    ) => {
      if (!unitBusinessId || queued.has(unitBusinessId)) return;
      queued.add(unitBusinessId);
      const existing = await invoiceUnitBusinessAttributesRepository.findInvoiceAttribute(
        invoiceId,
        unitBusinessId,
        undefined,
        transaction,
      );
      if (existing) return;
      toCreate.push({
        invoice_id: invoiceId,
        unit_business_id: unitBusinessId,
        type,
        status,
        batch_generated: false,
      });
    };

    if (senderUbId && receiverUbId) {
      await maybeAdd(senderUbId, "OUTGOING", "OPEN");
      await maybeAdd(receiverUbId, "INCOMING", initialStatus);
    } else if (senderUbId) {
      await maybeAdd(senderUbId, invoiceType ?? "OUTGOING", initialStatus);
    } else if (receiverUbId) {
      await maybeAdd(receiverUbId, invoiceType ?? "INCOMING", initialStatus);
    }

    if (toCreate.length > 0) {
      await invoiceUnitBusinessAttributesRepository.createInvoiceAttributes(toCreate, transaction);
    }
  }
}

export default new InvoiceCreationService();
