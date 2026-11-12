import { Op, WhereOptions } from "sequelize";
import { INVOICE_OPERATION_CODES, InvoiceOperationCode } from "../../../invoice-operation/invoice-operation.types";
import { InvoiceDirection } from "./invoice-direction";

export interface InvoiceOperationFacts {
  senderIsUnitBusiness: boolean;
  receiverIsUnitBusiness: boolean;
  // tpNF do ponto de vista do emitente; null quando a origem não informa.
  direction: InvoiceDirection | null;
  isReturn: boolean;
  isInternal: boolean;
}

// Operação da nota, mesma precedência do view-point.ts: interna > devolução > transferência > venda > compra.
export function resolveInvoiceOperationCode(facts: InvoiceOperationFacts): InvoiceOperationCode {
  if (facts.isInternal) return INVOICE_OPERATION_CODES.INTERNAL_TRANSFER;
  if (facts.isReturn) return INVOICE_OPERATION_CODES.RETURN;
  if (facts.senderIsUnitBusiness && facts.receiverIsUnitBusiness) return INVOICE_OPERATION_CODES.TRANSFER;
  if (facts.senderIsUnitBusiness && facts.direction === "OUTGOING") return INVOICE_OPERATION_CODES.SALE;
  return INVOICE_OPERATION_CODES.PURCHASE;
}

// Tira a nota interna das listagens de NF-e (null na coluna continua); sem a operação cadastrada não há nota interna, então não filtra.
export function notInternalInvoiceWhere(internalOperationId: string | null): WhereOptions {
  if (!internalOperationId) return {};
  return { invoice_operation_id: { [Op.or]: { [Op.is]: null, [Op.ne]: internalOperationId } } };
}
