// BullMQ nativo, número menor = mais prioritário (ver .claude/modules/uploader-queue.md).
export const UPLOADER_PRIORITY_CATEGORIES = [
  "PDV_SALES_REQUEST_RECEIPT",
  "UNMAPPED_INVOICE_PRODUCT",
  "INVOICE_DANFE",
  "CTE",
  "BACKUP",
] as const;

export type UploaderPriorityCategory = (typeof UPLOADER_PRIORITY_CATEGORIES)[number];

const PRIORITY_BY_CATEGORY: Record<UploaderPriorityCategory, number> = {
  PDV_SALES_REQUEST_RECEIPT: 1, // financeiro depende disso pra aprovar/rejeitar
  UNMAPPED_INVOICE_PRODUCT: 2, // operação de loja esperando confirmação
  INVOICE_DANFE: 3, // nota já existe, mas usuário quer ver o DANFE disponível logo
  CTE: 4, // arquivamento, ninguém no front está esperando
  BACKUP: 5, // manutenção diária, sem urgência
};

export function resolveUploaderPriority(category: UploaderPriorityCategory): number {
  return PRIORITY_BY_CATEGORY[category];
}
