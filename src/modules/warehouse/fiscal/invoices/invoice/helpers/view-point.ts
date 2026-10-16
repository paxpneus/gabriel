import { cleanDocument } from "../../../../../../shared/utils/normalizers/document";
import { InvoiceDirection, resolveInvoiceDirection } from "./invoice-direction";
import { NFE_RETURN_PURPOSE, NfeIde } from "./nfe-ide";

export type InvoiceViewPointType = "SALE" | "RECEIVING" | "TRANSFER" | "RETURN";

// null só quando o cálculo falhou — a nota é devolvida mesmo assim.
export interface InvoiceViewPoint {
  view_point_type: InvoiceViewPointType | null;
  view_point_direction: InvoiceDirection | null;
}

export interface InvoiceViewPointParties {
  sender_cnpj?: string | null;
  receiver_cnpj?: string | null;
}

export interface InvoiceViewPointContext {
  viewerCnpj: string | null;
  unitBusinessCnpjs: Set<string>;
}

const isUnitBusiness = (cnpj: string | null | undefined, context: InvoiceViewPointContext) =>
  !!cnpj && context.unitBusinessCnpjs.has(cleanDocument(cnpj));

// Só flag de resposta pro front. Sem XML (stub) assume saída — stubs nascem de pedido/transferência.
export function resolveInvoiceViewPoint(
  invoice: InvoiceViewPointParties,
  ide: NfeIde | null,
  context: InvoiceViewPointContext,
): InvoiceViewPoint {
  const operation = ide?.operationType ?? "OUTGOING";
  const senderIsUnitBusiness = isUnitBusiness(invoice.sender_cnpj, context);

  let viewPointType: InvoiceViewPointType = "RECEIVING";
  if (ide?.purpose === NFE_RETURN_PURPOSE) viewPointType = "RETURN";
  else if (senderIsUnitBusiness && isUnitBusiness(invoice.receiver_cnpj, context)) viewPointType = "TRANSFER";
  else if (senderIsUnitBusiness && operation === "OUTGOING") viewPointType = "SALE";

  // Emitente vê o próprio tpNF; destinatário vê o inverso (entrada emitida pela outra ponta = mercadoria saindo dele).
  const role = resolveInvoiceDirection(context.viewerCnpj, invoice);
  let viewPointDirection: InvoiceDirection | null = null;
  if (role === "OUTGOING") viewPointDirection = operation;
  else if (role === "INCOMING") viewPointDirection = operation === "OUTGOING" ? "INCOMING" : "OUTGOING";

  return { view_point_type: viewPointType, view_point_direction: viewPointDirection };
}
