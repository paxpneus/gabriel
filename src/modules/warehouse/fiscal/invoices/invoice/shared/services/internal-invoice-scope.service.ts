import { Op, Transaction, WhereOptions } from "sequelize";
import BaseService from "../../../../../../../shared/utils/base-models/base-service";
import Invoice from "../../invoice.model";
import invoiceAttributesRepository, { InvoiceAttributesRepository } from "../repositories/invoice-attributes.repository";
import invoiceOperationRepository from "../../../invoice-operation/invoice-operation.repository";
import { INVOICE_OPERATION_CODES } from "../../../invoice-operation/invoice-operation.types";
import { INTERNAL_INVOICE_REFUSED_MESSAGE } from "../helpers/invoice-operation";

// Separação da nota interna dos fluxos atuais: id da operação interna e guarda das ações por id (só internal/ aceita nota interna).
export class InternalInvoiceScopeService extends BaseService<Invoice, InvoiceAttributesRepository> {
  constructor() {
    super(invoiceAttributesRepository);
  }

  // Id da operação interna (cache em processo no repository); null se o seed da m351 não rodou.
  async getInternalOperationId(): Promise<string | null> {
    return invoiceOperationRepository.findIdByCode(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER);
  }

  // Recusa a ação atual se alguma nota do `where` (ex.: { id: ids }) é interna (1 query); sem a operação cadastrada não há nota interna.
  async assertNotInternalInvoices(where: WhereOptions, transaction?: Transaction): Promise<void> {
    const operationId = await this.getInternalOperationId();
    if (!operationId) return;

    const internal = await this.findAll({
      where: { [Op.and]: [where, { invoice_operation_id: operationId }] },
      attributes: ["number_system"],
      transaction,
    });
    if (internal.length) {
      throw new Error(`${INTERNAL_INVOICE_REFUSED_MESSAGE} [${internal.map((invoice) => invoice.number_system).join(", ")}]`);
    }
  }
}

export default new InternalInvoiceScopeService();
