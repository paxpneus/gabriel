import { OTHER_PAYMENT_METHOD_GROUP } from "../../payment_method/helpers/payment-method-groups";
import { CARD_BRANDS } from "../../../../../shared/constants/card-brands";

export interface OrderPaymentView {
  paymentMethod: { id: string; description: string } | null;
  // Só no grupo "Outros": o que é de fato (ex.: "Mercado Pago"); null nos demais.
  detail: string | null;
  amount: number;
  installments: number;
  // Código de bandeira da NF-e e o nome dele; null fora de cartão ou em pedido antigo.
  card_brand: number | null;
  card_brand_name: string | null;
  first_due_date: string | null;
  last_due_date: string | null;
}

// Junta as parcelas de um mesmo pagamento: forma + parcelas + bandeira
// (Bling "Crédito Master 2x" e "...3x" viram 2 itens). order_payments segue
// 1 linha por parcela; esta view é o que o front mostra e o que o match com
// comprovantes compara.
export const toPaymentsView = (
  payments: any[] | null | undefined,
): OrderPaymentView[] => {
  const rowsByKey = new Map<string, any[]>();
  for (const payment of payments ?? []) {
    const key = [
      payment.paymentMethod?.id ?? "",
      payment.installments ?? "",
      payment.card_brand ?? "",
    ].join("|");
    rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), payment]);
  }

  return [...rowsByKey.values()]
    .flatMap(splitRepeatedPayments)
    .map(toView)
    .sort((a, b) =>
      String(a.first_due_date ?? "").localeCompare(
        String(b.first_due_date ?? ""),
      ),
    );
};

// Mesma forma usada em 2+ pagamentos (ex.: dois cartões Master 2x = 4 linhas
// "2x"): separa em pagamentos de N parcelas, alternando por vencimento.
// Contagem que não fecha com N fica num grupo só (divergência visível).
function splitRepeatedPayments(rows: any[]): any[][] {
  const perPayment = Number(rows[0].installments ?? 0);
  // 1x só divide em cartão: forma sem cartão "à vista" (condicao vazia) pode ter parcelas lançadas à mão.
  const splittable =
    perPayment >= 2 || (perPayment === 1 && rows[0].card_brand != null);
  if (!splittable || rows.length <= perPayment) return [rows];
  if (rows.length % perPayment !== 0) return [rows];

  const count = rows.length / perPayment;
  const sorted = [...rows].sort(
    (a, b) =>
      String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")) ||
      Number(a.amount) - Number(b.amount),
  );
  const chunks: any[][] = Array.from({ length: count }, () => []);
  sorted.forEach((row, index) => chunks[index % count].push(row));
  return chunks;
}

// Linhas de um pagamento → item da view; installments é o que de fato veio
// (contagem de linhas), não o que a forma da Bling promete.
function toView(rows: any[]): OrderPaymentView {
  const method = rows[0].paymentMethod;
  const cardBrand: number | null = rows[0].card_brand ?? null;
  const dueDates = rows
    .map((row) => row.due_date as string | null)
    .filter((date): date is string => !!date)
    .sort();

  let detail: string | null = null;
  if (method?.id_system === OTHER_PAYMENT_METHOD_GROUP.key) {
    const names = new Set(
      rows.map((row) => row.form_description).filter(Boolean),
    );
    detail = names.size ? [...names].join(", ") : null;
  }

  let paymentMethod: OrderPaymentView["paymentMethod"] = null;
  if (method) {
    paymentMethod = { id: method.id, description: method.description };
  }

  const amount = rows.reduce((acc, row) => acc + Number(row.amount), 0);
  return {
    paymentMethod,
    detail,
    amount: Math.round(amount * 100) / 100,
    installments: rows.length,
    card_brand: cardBrand,
    card_brand_name:
      CARD_BRANDS.find((brand) => brand.code === cardBrand)?.name ?? null,
    first_due_date: dueDates[0] ?? null,
    last_due_date: dueDates[dueDates.length - 1] ?? null,
  };
}

// Não é coluna própria: vem de source_payload.parcelas (payload cru da Bling).
// Total de parcelas do pedido somando todas as formas (2x + 3x = 5).
export const countInstallments = (
  sourcePayload: Record<string, unknown> | null | undefined,
): number | null => {
  const parcelas = sourcePayload?.parcelas;
  return Array.isArray(parcelas) ? parcelas.length : null;
};
