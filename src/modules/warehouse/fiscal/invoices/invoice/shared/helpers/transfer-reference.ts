import { normalizeInvoiceNumber } from "./reference-description";

// Nota de venda + transferência vinculada (ou a vincular) nela: pelo id (vínculo novo) ou, sem id, pelo texto da referência (nota antiga).
export interface TransferReferenceInput {
  invoiceId: string;
  invoiceNumber: string | null | undefined;
  reference: string | null | undefined;
  transferInvoiceId?: string | null;
}

// Resultado das consultas de TransferReferenceService.assertTransferReferences: por id (vínculo novo) e por número (fallback legado).
export interface TransferReferenceLookup {
  transferNumberById: Map<string, string>;
  existingNumbers: Set<string>;
  referencingById: Array<{ id: string; number_system: string; transfer_invoice_id: string }>;
  referencingByNumber: Array<{ id: string; number_system: string; transfer_number: string }>;
}

// Número da nota de transferência dentro da referência ("REF: 782", "REF 0782", "782" → "782"); sem número → null.
export function extractTransferReferenceNumber(reference: string | null | undefined): string | null {
  const match = reference?.match(/\d+/);
  return match ? normalizeInvoiceNumber(match[0]) : null;
}

// Mensagem de erro (ou null) da regra 1 nota de venda ↔ 1 transferência: sem transferência, inexistente e já usada por outra nota.
// Com id compara por id (número repete entre CNPJs); sem id cai no número, como nas notas antigas.
export function transferReferenceProblems(
  refs: TransferReferenceInput[],
  lookup: TransferReferenceLookup,
  closingMessage: string,
): string | null {
  const references = refs.map((ref) => {
    if (ref.transferInvoiceId) {
      return {
        ...ref,
        key: `id:${ref.transferInvoiceId}`,
        transferLabel: lookup.transferNumberById.get(ref.transferInvoiceId) ?? `[${ref.transferInvoiceId}]`,
        exists: lookup.transferNumberById.has(ref.transferInvoiceId),
      };
    }
    const transferNumber = extractTransferReferenceNumber(ref.reference);
    return {
      ...ref,
      key: transferNumber ? `number:${transferNumber}` : null,
      transferLabel: transferNumber ?? "",
      exists: !!transferNumber && lookup.existingNumbers.has(transferNumber),
    };
  });
  const referencing = [
    ...lookup.referencingById.map((row) => ({ ...row, key: `id:${row.transfer_invoice_id}` })),
    ...lookup.referencingByNumber.map((row) => ({ ...row, key: `number:${row.transfer_number}` })),
  ];

  const withoutTransfer = references.filter((ref) => !ref.key);
  const notFound = references.filter((ref) => ref.key && !ref.exists);
  // Outra nota já aponta pra mesma transferência (no banco ou outra da lista); a linha da própria nota não conta.
  const alreadyUsed = references.flatMap((ref) => {
    if (!ref.key || !ref.exists) return [];
    const otherNumbers = new Set([
      ...referencing.filter((row) => row.key === ref.key && row.id !== ref.invoiceId).map((row) => row.number_system),
      ...references
        .filter((other) => other.key === ref.key && other.invoiceId !== ref.invoiceId)
        .map((other) => other.invoiceNumber),
    ]);
    if (!otherNumbers.size) return [];
    return [{ ...ref, otherNumbers: [...otherNumbers] }];
  });

  const problems: string[] = [];
  if (withoutTransfer.length) {
    problems.push(
      `Nota(s) de venda sem número da nota de transferência: ${withoutTransfer.map((ref) => ref.invoiceNumber).join(", ")}.`,
    );
  }
  if (notFound.length) {
    problems.push(
      `Nota(s) de transferência entre lojas não encontradas no sistema: ${notFound.map((ref) => `${ref.transferLabel} (ref. a nota de venda ${ref.invoiceNumber})`).join(", ")}.`,
    );
  }
  if (alreadyUsed.length) {
    problems.push(
      `Nota(s) de transferência já vinculadas a outra nota de venda: ${alreadyUsed.map((ref) => `${ref.transferLabel} (ref. a nota de venda ${ref.invoiceNumber}, já usada pela nota de venda ${ref.otherNumbers.join(", ")})`).join(", ")}.`,
    );
  }
  if (!problems.length) return null;
  return `${problems.join(" ")} ${closingMessage}`;
}

// Campos do vínculo nota de venda → transferência numa escrita genérica (PUT /:id, PUT /bulk, lote).
export interface TransferReferenceWriteData {
  transfer_invoice_id?: string | null;
  transfer_invoice_reference?: string | null;
}

// Separa o vínculo do resto do body: undefined = não mexe, null = remove (id null ou referência vazia), texto sem id → erro.
export function splitTransferLinkWrite<T extends TransferReferenceWriteData>(
  data: T,
): { transferInvoiceId: string | null | undefined; rest: Omit<T, keyof TransferReferenceWriteData> } {
  const { transfer_invoice_id: id, transfer_invoice_reference: reference, ...rest } = data;
  if (id !== undefined) return { transferInvoiceId: id, rest };
  if (reference === undefined) return { transferInvoiceId: undefined, rest };
  if (typeof reference === "string" && reference.trim()) {
    throw new Error("Selecione a nota de transferência na lista (ou envie o XML/DANFE da nota).");
  }
  return { transferInvoiceId: null, rest };
}
