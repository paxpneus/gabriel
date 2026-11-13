// Espelhado em migrations/m305-seed-bling-invoice-tracking-url.js; série "002" fixa, só o número varia.
export const INVOICE_TRACKING_URL_TEMPLATE =
  "https://paxpneus.acompanharentrega.com.br/?tpDoc=4&doc=002%2F{invoice_number}";

export function buildInvoiceTrackingUrl(
  numberSystem: string | null | undefined,
): string | null {
  const invoiceNumber = numberSystem?.trim().replace(/^0+/, "");
  if (!invoiceNumber) return null;
  return INVOICE_TRACKING_URL_TEMPLATE.replace(
    "{invoice_number}",
    encodeURIComponent(invoiceNumber),
  );
}
