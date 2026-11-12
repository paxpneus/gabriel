import { Transaction, WhereOptions } from "sequelize";
import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import sequelize from "../../../../../../../config/sequelize";
import Invoice from "../../invoice.model";
import { InvoiceAttributes } from "../../invoice.types";
import { InvoiceCancellationTarget } from "../types/cancellation.types";
import invoiceCancellationRepository, {
  InvoiceCancellationRepository,
} from "../repositories/cancellation.repository";
import { invoiceAttributesRepository, normalizeInvoiceNumber } from "../../shared";
import batchInvoicesService from "../../../../../expedition/batch-invoices/batch-invoices.service";

// Cancelamento de nota (devolução vinculada ou cancelada na integração) e consultas de pendência de cancelamento.
export class InvoiceCancellationService extends BaseService<Invoice, InvoiceCancellationRepository> {
  constructor() {
    super(invoiceCancellationRepository);
  }

  // Devolução (finNFe 4) com refNFe: cancela e vincula a nota de saída sem o bond manual.
  // Retorna o id da saída também se já vinculada a esta devolução — retry do job ainda precisa cancelar o PDV.
  async bondReturnInvoice(
    returnInvoice: { id: string; number_system: string },
    referencedXmlKey: string,
  ): Promise<string | null> {
    const outgoing =
      await this.repository.findOutgoingByXmlKey(referencedXmlKey);
    if (!outgoing) return null;

    const alreadyBonded =
      outgoing.statuses.every((status) => status === "CANCELLED") &&
      !!outgoing.return_invoice_reference &&
      normalizeInvoiceNumber(outgoing.return_invoice_reference) ===
        normalizeInvoiceNumber(returnInvoice.number_system);
    if (alreadyBonded) return outgoing.id;

    await sequelize.transaction(async (t) => {
      await this.applyCancellation(
        outgoing,
        { return_invoice_reference: returnInvoice.number_system },
        { type: "OUTGOING" },
        t,
      );

      await this.update(
        returnInvoice.id,
        { return_invoice_reference: outgoing.number_system },
        { transaction: t },
      );
    });

    return outgoing.id;
  }

  // Nota cancelada na própria integração (Bling situacao 2 / Tecinco): CANCELLED direto, sem devolução atrelada.
  async cancelInvoice(invoiceId: string): Promise<void> {
    const target = await this.repository.findCancellationTargetById(invoiceId);
    if (!target) return;

    const alreadyCancelled =
      target.statuses.every((status) => status === "CANCELLED") &&
      !target.openBatchInvoiceIds.length;
    if (alreadyCancelled) return;

    await sequelize.transaction((t) =>
      this.applyCancellation(target, {}, undefined, t),
    );
  }

  // Lote fechado (já expedido) mantém a nota; de TODO lote aberto ela sai, antes do CANCELLED (removeBatchInvoice volta pra OPEN).
  private async applyCancellation(
    target: InvoiceCancellationTarget,
    data: Partial<InvoiceAttributes>,
    attrWhere: WhereOptions | undefined,
    t: Transaction,
  ): Promise<void> {
    await Promise.all(
      target.openBatchInvoiceIds.map((id) =>
        // Cancelamento tira a nota de qualquer lote aberto, inclusive o interno.
        batchInvoicesService.removeBatchInvoice(id, t, { allowInternal: true }),
      ),
    );

    await invoiceAttributesRepository.updateWithAttributesForAllUnits(
      [target.id],
      { ...data, status: "CANCELLED" },
      attrWhere,
      t,
    );
  }
  // Card "Pendente Cancelamentos" de OrderService.getOrdersStatusSummary.
  async countPendingCancellation(unitBusinessId: string): Promise<number> {
    return this.repository.countPendingCancellation(unitBusinessId);
  }

  // Sync de canceladas da Tecinco: só reenfileira nota que ainda falta cancelar em alguma das unit businesses.
  async findXmlKeysNotCancelledInUnitBusinesses(
    xmlKeys: string[],
    unitBusinessNumbers: string[],
  ): Promise<string[]> {
    return this.repository.findXmlKeysNotCancelledInUnitBusinesses(
      xmlKeys,
      unitBusinessNumbers,
    );
  }
}

export default new InvoiceCancellationService();
