import { cleanDocument } from "../../../../../shared/utils/normalizers/document";

export function assertTransshipment(
    invoice: { sender_cnpj: string | null; receiver_cnpj: string | null },
    unitBusiness: { cnpj: string; transshipment_allowed?: boolean } | null,
  ): void {
    if (!unitBusiness || unitBusiness.transshipment_allowed) return;

    const unitCnpj = cleanDocument(unitBusiness.cnpj);

    if (!invoice.sender_cnpj || !invoice.receiver_cnpj) {
        throw new Error("Cnpj emitente ou destinatário não encontrados pela nota fiscal!")
    }

    const allowed =
      cleanDocument(invoice.sender_cnpj) === unitCnpj ||
      cleanDocument(invoice.receiver_cnpj) === unitCnpj;

    if (!allowed) {
      throw new Error(
        "Leitura bloqueada: nota fiscal não pertence à sua unidade de negócio",
      );
    }
  }