export interface InvoiceProductQuantity {
  product_id: string;
  quantity_expected: number | string;
}

const QUANTITY_EPSILON = 0.0001;

function quantitiesByProduct(
  items: InvoiceProductQuantity[],
): Map<string, number> {
  return items.reduce((quantities, item) => {
    const quantity = Number(item.quantity_expected);
    quantities.set(
      item.product_id,
      (quantities.get(item.product_id) ?? 0) + quantity,
    );
    return quantities;
  }, new Map<string, number>());
}

// Uma nota sem itens persistidos ainda pode ser uma nota provisória. Nesse
// caso, a comparação espera o import completo em vez de acusar divergência.
export function invoiceProductsMatch(
  saleItems: InvoiceProductQuantity[],
  transferItems: InvoiceProductQuantity[],
): boolean | null {
  if (saleItems.length === 0 || transferItems.length === 0) return null;

  const saleQuantities = quantitiesByProduct(saleItems);
  const transferQuantities = quantitiesByProduct(transferItems);

  if (saleQuantities.size !== transferQuantities.size) return false;

  return [...saleQuantities.entries()].every(
    ([productId, quantity]) =>
      Math.abs((transferQuantities.get(productId) ?? Number.NaN) - quantity) <
      QUANTITY_EPSILON,
  );
}
