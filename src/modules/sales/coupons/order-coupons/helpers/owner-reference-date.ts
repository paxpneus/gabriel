const DAY_MS = 24 * 60 * 60 * 1000;

// orders.date só tem o dia: usa created_at (ingestão, minutos após a venda) limitado ao fim do
// dia do pedido, pra importação atrasada não cair no dono seguinte do cupom.
export function couponOwnerReferenceDate(order: { date?: Date | null; createdAt: Date }): Date {
  if (!order.date) return order.createdAt;
  const endOfOrderDay = new Date(new Date(order.date).getTime() + DAY_MS);
  return order.createdAt < endOfOrderDay ? order.createdAt : endOfOrderDay;
}
