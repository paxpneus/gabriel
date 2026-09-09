import { cleanDocument } from "../../../../../../shared/utils/normalizers/document";

export interface TransshipmentPurposeContext {
  isSender: boolean;
  isReceiver: boolean;
  eligible: boolean;
  purpose: "REGULAR" | "TRANSSHIPMENT";
}

/**
 * Uma nota é "de transbordo" para uma unit_business quando ela não é nem
 * emitente nem destinatária da nota, mas a filial tem transshipment_allowed
 * (só recebe/redespacha carga de terceiros fisicamente). `eligible` é a
 * mesma condição que já bloqueia acesso a uma nota fora dessa relação.
 */
export function resolveInvoicePurposeForUnitBusiness(
  unitBusiness: { cnpj: string; transshipment_allowed?: boolean },
  invoice: { sender_cnpj: string | null; receiver_cnpj: string | null },
): TransshipmentPurposeContext {
  const unitCnpj = cleanDocument(unitBusiness.cnpj);
  const isSender = cleanDocument(invoice.sender_cnpj ?? "") === unitCnpj;
  const isReceiver = cleanDocument(invoice.receiver_cnpj ?? "") === unitCnpj;
  const eligible = !!unitBusiness.transshipment_allowed || isSender || isReceiver;
  const purpose: "REGULAR" | "TRANSSHIPMENT" =
    !isSender && !isReceiver && unitBusiness.transshipment_allowed
      ? "TRANSSHIPMENT"
      : "REGULAR";

  return { isSender, isReceiver, eligible, purpose };
}
