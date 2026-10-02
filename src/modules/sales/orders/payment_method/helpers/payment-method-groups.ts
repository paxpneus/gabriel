// Catálogo de payment_methods é agrupado por `tipoPagamento` da Bling (não uma
// linha por forma cadastrada na conta: "Crédito Visa 2x", "Crédito Elo 3x"...
// viram só "Cartão de Crédito"). `key` é o id_system da linha agrupada.
// Espelhado em migrations/m301-seed-payment-method-groups.js (migration é
// autocontida) — mudou aqui, mudar lá.
export interface PaymentMethodGroup {
  key: string;
  description: string;
  blingTypes: number[];
}

export const OTHER_PAYMENT_METHOD_GROUP: PaymentMethodGroup = {
  key: "99",
  description: "Outros",
  blingTypes: [99],
};

export const PAYMENT_METHOD_GROUPS: PaymentMethodGroup[] = [
  { key: "1", description: "Dinheiro", blingTypes: [1] },
  { key: "2", description: "Cheque", blingTypes: [2] },
  { key: "3", description: "Cartão de Crédito", blingTypes: [3] },
  { key: "4", description: "Cartão de Débito", blingTypes: [4] },
  { key: "15", description: "Boleto Bancário", blingTypes: [15] },
  { key: "17", description: "Pix", blingTypes: [17, 20] },
  { key: "18", description: "Transferência Bancária", blingTypes: [16, 18] },
  OTHER_PAYMENT_METHOD_GROUP,
];

// Qualquer tipo fora da lista (vales, cashback, "sem pagamento"...) cai em "Outros".
export function paymentMethodGroupForBlingType(
  blingType: number | null | undefined,
): PaymentMethodGroup {
  return (
    PAYMENT_METHOD_GROUPS.find((group) =>
      group.blingTypes.includes(Number(blingType)),
    ) ?? OTHER_PAYMENT_METHOD_GROUP
  );
}
