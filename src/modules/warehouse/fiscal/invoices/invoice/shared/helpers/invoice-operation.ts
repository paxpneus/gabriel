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

// Mensagens pro usuário quando um fluxo atual recebe nota/lote interno (só os fluxos de internal/ aceitam).
export const INTERNAL_INVOICE_REFUSED_MESSAGE = "Nota interna: use a tela de nota interna.";
export const INTERNAL_BATCH_REFUSED_MESSAGE = "Lote de nota interna: use a tela de nota interna.";

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
