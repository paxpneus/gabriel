export interface OrderPaymentView {
  paymentMethod: { id: string; description: string } | null;
  amount: number;
  installments: number;
  first_due_date: string | null;
  last_due_date: string | null;
}

// Só pra resposta ao front: junta as parcelas da mesma forma de pagamento
// (12x "Cartão de Crédito" vira 1 item). order_payments segue 1 linha por
// parcela, e o match com comprovantes lê as linhas cruas, nunca esta view.
export const toPaymentsView = (
  payments: any[] | null | undefined,
): OrderPaymentView[] => {
  const groups = new Map<string, OrderPaymentView>();

  for (const payment of payments ?? []) {
    const method = payment.paymentMethod;
    const key = method?.id ?? "";
    const dueDate: string | null = payment.due_date ?? null;
    const group = groups.get(key);

    if (!group) {
      groups.set(key, {
        paymentMethod: method
          ? { id: method.id, description: method.description }
          : null,
        amount: Number(payment.amount),
        installments: 1,
        first_due_date: dueDate,
        last_due_date: dueDate,
      });
      continue;
    }

    group.amount += Number(payment.amount);
    group.installments += 1;
    if (dueDate && (!group.first_due_date || dueDate < group.first_due_date)) {
      group.first_due_date = dueDate;
    }
    if (dueDate && (!group.last_due_date || dueDate > group.last_due_date)) {
      group.last_due_date = dueDate;
    }
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      amount: Math.round(group.amount * 100) / 100,
    }))
    .sort((a, b) =>
      String(a.first_due_date ?? "").localeCompare(
        String(b.first_due_date ?? ""),
      ),
    );
};

// Não é coluna própria: vem de source_payload.parcelas (payload cru da Bling).
export const countInstallments = (
  sourcePayload: Record<string, unknown> | null | undefined,
): number | null => {
  const parcelas = sourcePayload?.parcelas;
  return Array.isArray(parcelas) ? parcelas.length : null;
};
