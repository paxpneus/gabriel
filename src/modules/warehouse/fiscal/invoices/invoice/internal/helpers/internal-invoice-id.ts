// id_system da nota interna: emitente + número, o mesmo na S (origem) e na E (destino) → uma nota só por transferência.
export function buildInternalInvoiceIdSystem(senderCnpj: string, numero: string | number): string {
  return `TCAR-INTERNAL-${senderCnpj}-${numero}`;
}
