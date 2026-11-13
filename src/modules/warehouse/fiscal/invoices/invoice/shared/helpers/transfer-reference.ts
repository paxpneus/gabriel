import { normalizeInvoiceNumber } from "./reference-description";

// Nota de venda + referência à transferência gravada (ou a gravar) nela.
export interface TransferReferenceInput {
  invoiceId: string;
  invoiceNumber: string | null | undefined;
  reference: string | null | undefined;
}

// Número da nota de transferência dentro da referência ("REF: 782", "REF 0782", "782" → "782"); sem número → null.
export function extractTransferReferenceNumber(reference: string | null | undefined): string | null {
  const match = reference?.match(/\d+/);
  return match ? normalizeInvoiceNumber(match[0]) : null;
}

// Mensagem de erro (ou null) da regra 1 nota de venda ↔ 1 transferência, já com as consultas feitas por
// InvoiceService.assertTransferReferences: sem número, número inexistente e transferência já usada por outra nota.
export function transferReferenceProblems(
  refs: TransferReferenceInput[],
  existing: Set<string>,
  referencing: Array<{ id: string; number_system: string; transfer_number: string }>,
  closingMessage: string,
): string | null {
  const references = refs.map((ref) => ({ ...ref, transferNumber: extractTransferReferenceNumber(ref.reference) }));
  const withoutNumber = references.filter((ref) => !ref.transferNumber);
  const notFound = references.filter((ref) => ref.transferNumber && !existing.has(ref.transferNumber));
  // Outra nota já aponta pra mesma transferência (no banco ou outra da lista); a linha da própria nota não conta.
  const alreadyUsed = references.flatMap((ref) => {
    if (!ref.transferNumber || !existing.has(ref.transferNumber)) return [];
    const otherNumbers = new Set([
      ...referencing
        .filter((row) => row.transfer_number === ref.transferNumber && row.id !== ref.invoiceId)
        .map((row) => row.number_system),
      ...references
        .filter((other) => other.transferNumber === ref.transferNumber && other.invoiceId !== ref.invoiceId)
        .map((other) => other.invoiceNumber),
    ]);
    if (!otherNumbers.size) return [];
    return [{ ...ref, otherNumbers: [...otherNumbers] }];
  });

  const problems: string[] = [];
  if (withoutNumber.length) {
    problems.push(
      `Nota(s) de venda sem número da nota de transferência: ${withoutNumber.map((ref) => ref.invoiceNumber).join(", ")}.`,
    );
  }
  if (notFound.length) {
    problems.push(
      `Nota(s) de transferência entre lojas não encontradas no sistema: ${notFound.map((ref) => `${ref.transferNumber} (ref. a nota de venda ${ref.invoiceNumber})`).join(", ")}.`,
    );
  }
  if (alreadyUsed.length) {
    problems.push(
      `Nota(s) de transferência já vinculadas a outra nota de venda: ${alreadyUsed.map((ref) => `${ref.transferNumber} (ref. a nota de venda ${ref.invoiceNumber}, já usada pela nota de venda ${ref.otherNumbers.join(", ")})`).join(", ")}.`,
    );
  }
  if (!problems.length) return null;
  return `${problems.join(" ")} ${closingMessage}`;
}
