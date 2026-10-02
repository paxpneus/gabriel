import { normalizeMatchValue } from "../../../../../shared/utils/normalizers/text";
import {
  PaymentReceiptPaymentMethod,
  PaymentReceiptType,
} from "../pdv-sales-request.types";

// Comparação por palavra-chave, não igualdade — a descrição da forma de
// pagamento é texto livre configurado por conta na Bling ("Mercado Pago",
// "Cartão de Crédito Itaú"...), não um enum fechado 1:1 com tipo_comprovante.
// Resultado é informativo (mostra divergência pro financeiro), nunca bloqueia
// a transição de status sozinho.
const GENERIC_CARD_KEYWORD = "CARTAO";

const RECEIPT_TYPE_KEYWORDS: Record<PaymentReceiptType, string[]> = {
  pix: ["PIX"],
  cartao_credito: ["CREDITO", "CARTAO"],
  cartao_debito: ["DEBITO", "CARTAO"],
  transferencia: ["TRANSFERENCIA", "DEPOSITO"],
};

// Palavras-chave em português quase sempre vêm acentuadas ("Crédito",
// "Débito", "Transferência") — sem remover o acento aqui, o includes()
// nunca bateria com a forma como a Bling de fato escreve isso.
function normalizeDescription(description: string | null): string | null {
  const upperCased = normalizeMatchValue(description);
  if (!upperCased) return null;
  return upperCased.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function paymentMethodMatchesReceipt(
  paymentMethodDescription: string | null,
  receiptType: PaymentReceiptType | null,
): boolean | null {
  const normalized = normalizeDescription(paymentMethodDescription);
  if (!normalized || !receiptType) return null;

  const keywords = RECEIPT_TYPE_KEYWORDS[receiptType];
  if (
    keywords
      .filter((keyword) => keyword !== GENERIC_CARD_KEYWORD)
      .some((keyword) => normalized.includes(keyword))
  ) {
    return true;
  }

  // "Cartão" genérico não vale quando a descrição já nomeia o outro tipo
  // ("Cartão de Débito" nunca casa com comprovante de crédito).
  if (
    !keywords.includes(GENERIC_CARD_KEYWORD) ||
    !normalized.includes(GENERIC_CARD_KEYWORD)
  ) {
    return false;
  }
  const otherCardKeyword =
    receiptType === "cartao_credito" ? "DEBITO" : "CREDITO";
  return !normalized.includes(otherCardKeyword);
}

// Inversa de paymentMethodMatchesReceipt: tipo de comprovante derivado da
// descrição da forma escolhida. null quando não dá pra afirmar — descrição
// sem palavra-chave ("Mercado Pago", "Boleto") ou só "Cartão" (crédito ou
// débito, ambíguo).
export function receiptTypeFromPaymentMethod(
  paymentMethodDescription: string | null,
): PaymentReceiptType | null {
  const normalized = normalizeDescription(paymentMethodDescription);
  if (!normalized) return null;

  const specificTypes: PaymentReceiptType[] = [
    "pix",
    "cartao_credito",
    "cartao_debito",
    "transferencia",
  ];
  const matches = specificTypes.filter((type) =>
    RECEIPT_TYPE_KEYWORDS[type]
      .filter((keyword) => keyword !== GENERIC_CARD_KEYWORD)
      .some((keyword) => normalized.includes(keyword)),
  );

  return matches.length === 1 ? matches[0] : null;
}

// Acha no catálogo a forma que corresponde ao tipo extraído da imagem.
// Prefere as formas que a própria Bling mandou no pedido (é com elas que o
// comprovante vai ser conferido); sem candidata ali, cai pro catálogo todo.
// Só devolve quando há exatamente uma forma candidata — ambíguo vira null.
export function resolvePaymentMethodForReceipt(
  receiptType: PaymentReceiptType | null,
  orderMethods: PaymentReceiptPaymentMethod[],
  catalog: PaymentReceiptPaymentMethod[],
): PaymentReceiptPaymentMethod | null {
  if (!receiptType) return null;

  for (const pool of [orderMethods, catalog]) {
    const candidates = new Map(
      pool
        .filter(
          (method) =>
            paymentMethodMatchesReceipt(method.description, receiptType) ===
            true,
        )
        .map((method) => [method.id, method]),
    );
    if (candidates.size === 1) return [...candidates.values()][0];
    if (candidates.size > 1) return null;
  }

  return null;
}

export interface OrderPaymentMethodRef {
  id: string | null;
  description: string | null;
}

export interface ReceiptPaymentRef {
  type: PaymentReceiptType | null;
  paymentMethodId: string | null;
}

// Forma escolhida/resolvida no comprovante manda (compara por id com a da
// Bling); sem ela, cai pro tipo extraído por palavra-chave.
function pairMatches(
  method: OrderPaymentMethodRef,
  receipt: ReceiptPaymentRef,
): boolean {
  if (receipt.paymentMethodId) return receipt.paymentMethodId === method.id;
  return paymentMethodMatchesReceipt(method.description, receipt.type) === true;
}

// Pedido pode ter várias formas de pagamento (parcelas Bling) e a solicitação
// vários comprovantes: bate só se TODA forma tem um comprovante correspondente
// e TODO comprovante corresponde a uma forma. null se faltar dado dos dois lados.
export function paymentMethodsMatchReceipts(
  orderMethods: OrderPaymentMethodRef[],
  receipts: ReceiptPaymentRef[],
): boolean | null {
  if (!orderMethods.length || !receipts.length) return null;
  if (receipts.some((r) => !r.type && !r.paymentMethodId)) return null;

  const everyMethodCovered = orderMethods.every((method) =>
    receipts.some((receipt) => pairMatches(method, receipt)),
  );
  const everyReceiptCovered = receipts.every((receipt) =>
    orderMethods.some((method) => pairMatches(method, receipt)),
  );

  return everyMethodCovered && everyReceiptCovered;
}
