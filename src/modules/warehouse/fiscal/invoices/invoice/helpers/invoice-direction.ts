import { cleanDocument } from "../../../../../../shared/utils/normalizers/document";

export type InvoiceDirection = "OUTGOING" | "INCOMING";

interface InvoiceParties {
  sender_cnpj?: string | null;
  receiver_cnpj?: string | null;
}

/** Direção da nota do ponto de vista do CNPJ informado; sender tem prioridade se os dois forem iguais. */
export function resolveInvoiceDirection(
  cnpj: string | null | undefined,
  invoice: InvoiceParties,
): InvoiceDirection | null {
  const target = cnpj ? cleanDocument(cnpj) : "";
  if (!target) return null;

  if (invoice.sender_cnpj && cleanDocument(invoice.sender_cnpj) === target) {
    return "OUTGOING";
  }
  if (invoice.receiver_cnpj && cleanDocument(invoice.receiver_cnpj) === target) {
    return "INCOMING";
  }

  // CNPJ fora da nota: ainda sem tratamento, será usado pra identificar transbordo de nota.
  return null;
}
