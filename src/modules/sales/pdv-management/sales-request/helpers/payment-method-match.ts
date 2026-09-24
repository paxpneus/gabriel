import { normalizeMatchValue } from "../../../../../shared/utils/normalizers/text";
import { PaymentReceiptType } from "../pdv-sales-request.types";

// Comparação por palavra-chave, não igualdade — a descrição da forma de
// pagamento é texto livre configurado por conta na Bling ("Mercado Pago",
// "Cartão de Crédito Itaú"...), não um enum fechado 1:1 com tipo_comprovante.
// Resultado é informativo (mostra divergência pro financeiro), nunca bloqueia
// a transição de status sozinho.
export function paymentMethodMatchesReceipt(
  paymentMethodDescription: string | null,
  receiptType: PaymentReceiptType | null,
): boolean | null {
  const upperCased = normalizeMatchValue(paymentMethodDescription);
  if (!upperCased || !receiptType) return null;

  // Palavras-chave em português quase sempre vêm acentuadas ("Crédito",
  // "Débito", "Transferência") — sem remover o acento aqui, o includes()
  // abaixo nunca bateria com a forma como a Bling de fato escreve isso.
  const normalized = upperCased
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

  switch (receiptType) {
    case "pix":
      return normalized.includes("PIX");
    case "cartao_credito":
      return normalized.includes("CREDITO") || normalized.includes("CARTAO");
    case "cartao_debito":
      return normalized.includes("DEBITO") || normalized.includes("CARTAO");
    case "transferencia":
      return (
        normalized.includes("TRANSFERENCIA") || normalized.includes("DEPOSITO")
      );
  }
}
