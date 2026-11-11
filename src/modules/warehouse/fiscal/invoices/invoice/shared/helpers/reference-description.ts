// Número de nota sem zeros à esquerda — DANFE/Tecinco às vezes trazem "020309", o refNFe do XML nunca.
export function normalizeInvoiceNumber(number: string | number): string {
  return String(number).trim().replace(/^0+(?=\d)/, "");
}

// Descrição de nota que referencia outra ("REF: <número>") — mesmo formato do refNFe do XML.
export function buildInvoiceReferenceDescription(
  referencedNumber: string | number,
): string {
  return `REF: ${normalizeInvoiceNumber(referencedNumber)}`;
}
