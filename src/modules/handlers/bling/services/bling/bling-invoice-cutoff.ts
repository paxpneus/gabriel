const DEFAULT_BLING_INVOICE_CUTOFF_AT = "2026-05-08T00:00:00-03:00";

export const BLING_INVOICE_CUTOFF_AT =
  process.env.BLING_INVOICE_CUTOFF_AT ?? DEFAULT_BLING_INVOICE_CUTOFF_AT;

function parseBlingDateLike(value: string): Date | null {
  const normalized = value.trim();
  if (!normalized) return null;

  const dateOnlyMatch = /^\d{4}-\d{2}-\d{2}$/.test(normalized);
  if (dateOnlyMatch) {
    return new Date(`${normalized}T00:00:00-03:00`);
  }

  const withTimeSeparator = normalized.replace(" ", "T");
  const hasTimezone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(withTimeSeparator);
  const parsed = new Date(
    hasTimezone ? withTimeSeparator : `${withTimeSeparator}-03:00`,
  );

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function parseBlingInvoiceDate(
  value?: string | Date | null,
): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  return parseBlingDateLike(value);
}

export const BLING_INVOICE_CUTOFF_DATE = (() => {
  const parsed = parseBlingInvoiceDate(BLING_INVOICE_CUTOFF_AT);
  if (!parsed) {
    throw new Error(
      `BLING_INVOICE_CUTOFF_AT invalido: ${BLING_INVOICE_CUTOFF_AT}`,
    );
  }

  return parsed;
})();

export const BLING_INVOICE_CUTOFF_DATE_PARAM =
  BLING_INVOICE_CUTOFF_AT.slice(0, 10);

export function getBlingInvoiceReferenceDate(invoice: {
  dataEmissao?: string | null;
  dataOperacao?: string | null;
}): Date | null {
  return parseBlingInvoiceDate(invoice.dataEmissao ?? invoice.dataOperacao);
}

export function isBlingInvoiceOnOrAfterCutoff(
  value?: string | Date | null,
): boolean {
  const parsed = parseBlingInvoiceDate(value);
  if (!parsed) return false;

  return parsed.getTime() >= BLING_INVOICE_CUTOFF_DATE.getTime();
}

export function isKnownBlingInvoiceBeforeCutoff(
  value?: string | Date | null,
): boolean {
  const parsed = parseBlingInvoiceDate(value);
  if (!parsed) return false;

  return parsed.getTime() < BLING_INVOICE_CUTOFF_DATE.getTime();
}

export function formatBlingInvoiceCutoffForLog(): string {
  return `${BLING_INVOICE_CUTOFF_DATE_PARAM} 00:00 America/Sao_Paulo`;
}
