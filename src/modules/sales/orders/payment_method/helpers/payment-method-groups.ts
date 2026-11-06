// Catálogo de payment_methods é agrupado ("Cartão de Crédito", "Pix"...) e vem do
// seed migrations/m301-seed-payment-method-groups.js; cada linha guarda em
// raw_payload.blingTypes os tipoPagamento da Bling que cobre. "Outros" é o
// destino de forma da integração ainda sem mapeamento (ver unmapped_entities).
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
