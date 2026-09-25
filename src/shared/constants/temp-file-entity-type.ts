// Entidades com finalização automática de upload (ver .claude/modules/uploader-queue.md).
export const TEMP_FILE_ENTITY_TYPES = [
  "PDV_SALES_REQUEST_RECEIPT",
  "UNMAPPED_INVOICE_PRODUCT",
  "INVOICE_DANFE",
  "CTE",
] as const;

export type TempFileEntityType = (typeof TEMP_FILE_ENTITY_TYPES)[number];
