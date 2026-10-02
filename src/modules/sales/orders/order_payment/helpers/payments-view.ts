export interface OrderPaymentView {
  id: string;
  amount: number;
  due_date: string | null;
  paymentMethod: { id: string; description: string } | null;
}

// Ordena por vencimento e deixa só os campos que o front consome.
export const toPaymentsView = (payments: any[] | null | undefined): OrderPaymentView[] =>
  [...(payments ?? [])]
    .sort((a, b) => String(a.due_date ?? "").localeCompare(String(b.due_date ?? "")))
    .map((payment) => ({
      id: payment.id,
      amount: payment.amount,
      due_date: payment.due_date ?? null,
      paymentMethod: payment.paymentMethod
        ? {
            id: payment.paymentMethod.id,
            description: payment.paymentMethod.description,
          }
        : null,
    }));

// Não é coluna própria: vem de source_payload.parcelas (payload cru da Bling).
export const countInstallments = (
  sourcePayload: Record<string, unknown> | null | undefined,
): number | null => {
  const parcelas = sourcePayload?.parcelas;
  return Array.isArray(parcelas) ? parcelas.length : null;
};
