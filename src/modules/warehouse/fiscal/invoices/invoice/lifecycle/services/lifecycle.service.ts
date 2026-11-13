import { Op, Transaction, WhereOptions } from "sequelize";
import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import sequelize from "../../../../../../../config/sequelize";
import { getBrazilDate } from "../../../../../../../shared/utils/normalizers/date";
import Invoice from "../../invoice.model";
import { InvoiceAttributes } from "../../invoice.types";
import { InvoiceUnitBusinessAttributesStatus } from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import invoiceUnitBusinessAttributesRepository from "../../../invoice-unit-business-attributes/invoice-unit-business-attributes.repository";
import invoiceLifecycleRepository, {
  InvoiceLifecycleRepository,
} from "../repositories/lifecycle.repository";
import { internalInvoiceScopeService, invoiceAttributesRepository, transferReferenceService } from "../../shared";

// Mudanças de status/atributos da nota por unit business: abrir, finalizar, uso e consumo, agendar e atualização genérica.
export class InvoiceLifecycleService extends BaseService<Invoice, InvoiceLifecycleRepository> {
  constructor() {
    super(invoiceLifecycleRepository);
  }

  async updateInvoicesOpen(ids: string[], unitBusinessId: string) {
    // Nota interna só pelos fluxos de internal/.
    await internalInvoiceScopeService.assertNotInternalInvoices({ id: ids });
    return invoiceAttributesRepository.updateWithAttributes(
      ids,
      unitBusinessId,
      { status: "PENDING" },
      { status: "OPEN" },
    );
  }

  // Uso e consumo: finaliza na unit business e acrescenta o motivo em observation (nunca sobrescreve).
  async markAsInternalUse(ids: string[], unitBusinessId: string) {
    // Nota interna só pelos fluxos de internal/.
    await internalInvoiceScopeService.assertNotInternalInvoices({ id: ids });
    await sequelize.transaction(async (t) => {
      await invoiceAttributesRepository.updateWithAttributes(
        ids,
        unitBusinessId,
        { status: "FINISHED" },
        undefined,
        t,
      );
      await this.repository.appendObservation(ids, "Nota de uso e consumo", t);
    });
  }

  // Finaliza manualmente nota OPEN/PENDING na unit business; observação obrigatória justifica o fechamento.
  async finishPendingInvoice(
    id: string,
    unitBusinessId: string,
    observation: string,
  ) {
    const trimmedObservation = observation?.trim();
    if (!trimmedObservation) {
      throw new Error("Observação é obrigatória para finalizar a nota");
    }
    // Nota interna só pelos fluxos de internal/.
    await internalInvoiceScopeService.assertNotInternalInvoices({ id });

    const attribute = await invoiceUnitBusinessAttributesRepository.findInvoiceAttribute(
      id,
      unitBusinessId,
    );
    if (!attribute) {
      throw new Error("Nota fiscal não encontrada");
    }
    if (!["OPEN", "PENDING"].includes(attribute.status)) {
      throw new Error("Só é possível finalizar notas com status pendente");
    }

    await sequelize.transaction(async (t) => {
      await invoiceAttributesRepository.updateWithAttributes(
        [id],
        unitBusinessId,
        { status: "FINISHED" },
        { status: { [Op.in]: ["OPEN", "PENDING"] } },
        t,
      );
      await this.repository.appendObservation([id], trimmedObservation, t);
    });
  }

  async updateInvoicesForAllUnitBusiness(
    invoiceIds: string[],
    data: Partial<
      InvoiceAttributes & { status: string; batch_generated: boolean }
    >,
    attrWhere?: WhereOptions,
  ): Promise<void> {
    return invoiceAttributesRepository.updateWithAttributesForAllUnits(
      invoiceIds,
      data,
      attrWhere,
    );
  }

  async scheduleInvoice(
    id: string,
    expectedDate: string,
    unitBusinessId: string,
  ) {
    if (!expectedDate) {
      throw new Error("Data inválida");
    }

    const formatToBrazilDate = (dateStr: string): string => {
      const [year, month, day] = dateStr.split("-");
      return `${day}${month}${year}`;
    };

    const todayBR = getBrazilDate();
    const expectedBR = formatToBrazilDate(expectedDate);

    // if (expectedBR < todayBR) {
    //   throw new Error(
    //     "Data inválida, não é possível agendar notas para dias anteriores a hoje!",
    //   );
    // }

    const invoice = await this.repository.getInvoice(id, unitBusinessId);
    if (!invoice) {
      throw new Error("Nota fiscal não encontrada");
    }

    if (
      ["LATE", "FINISHED", "CANCELLED"].includes(
        invoice.unitBusinessAttributes?.status!,
      )
    ) {
      throw new Error(
        "Status não permitido para alterar data prevista de entrega",
      );
    }

    await invoiceAttributesRepository.updateWithAttributes([id], unitBusinessId, {
      status: "SCHEDULED",
      expected_receiving: expectedDate,
    });
  }
}

export default new InvoiceLifecycleService();
