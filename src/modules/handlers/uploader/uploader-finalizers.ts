import { TempFileEntityType } from "../../../shared/constants/temp-file-entity-type";
import { isTempFileSentinelPath } from "../temp-file/temp-file.constants";
import pdvSalesRequestReceiptService from "../../sales/pdv-management/sales-request-receipt/pdv-sales-request-receipt.service";
import unmappedInvoiceProductService from "../../inventory/unmapped-invoice-product/unmapped-invoice-product.service";
import invoiceService from "../../warehouse/fiscal/invoices/invoice/invoice.service";
import { JobTracker } from "../../warehouse/fiscal/ctes/cte/helpers/cte-download.tracker";
import socketService from "../socket/services/socket.service";

// Grava o path real na entidade de destino — sempre via SERVICE da entidade
// (layering), nunca repository/model direto. CTE usa o JobTracker (Redis) no lugar de um service.
export const FINALIZERS: Record<
  TempFileEntityType,
  (entityId: string, realPath: string) => Promise<unknown | null>
> = {
  PDV_SALES_REQUEST_RECEIPT: (entityId, realPath) =>
    pdvSalesRequestReceiptService.update(entityId, { path: realPath }),
  UNMAPPED_INVOICE_PRODUCT: (entityId, realPath) =>
    unmappedInvoiceProductService.update(entityId, { image_path: realPath }),
  INVOICE_DANFE: (entityId, realPath) =>
    invoiceService.update(entityId, { danfe_path: realPath }),
  CTE: async (entityId, realPath) => {
    const existing = await JobTracker.get(entityId);
    if (!existing) return null; // tracker expirou (TTL 1h) — nada pra notificar

    const updated = await JobTracker.update(entityId, { status: "done", filePath: realPath });
    if (updated.userId) {
      socketService.emitToUser(updated.userId, "job:completed", {
        jobId: entityId,
        resultado: { path: realPath },
      });
    }
    return updated;
  },
};

export type FinalizeCheckResult = "missing" | "still-sentinel" | "already-real";

// Usado pelo sweep de reconciliação (UploaderQueue.processReconcile).
export const FINALIZE_CHECKERS: Record<
  TempFileEntityType,
  (entityId: string) => Promise<FinalizeCheckResult>
> = {
  PDV_SALES_REQUEST_RECEIPT: async (entityId) => {
    const receipt = await pdvSalesRequestReceiptService.findById(entityId);
    if (!receipt) return "missing";
    return isTempFileSentinelPath(receipt.path) ? "still-sentinel" : "already-real";
  },
  UNMAPPED_INVOICE_PRODUCT: async (entityId) => {
    const unmapped = await unmappedInvoiceProductService.findById(entityId);
    if (!unmapped) return "missing";
    return isTempFileSentinelPath(unmapped.image_path) ? "still-sentinel" : "already-real";
  },
  // Sem sentinela — danfe_path aceita NULL, então "ainda não subiu" = falsy.
  INVOICE_DANFE: async (entityId) => {
    const invoice = await invoiceService.findById(entityId);
    if (!invoice) return "missing";
    return invoice.danfe_path ? "already-real" : "still-sentinel";
  },
  CTE: async (entityId) => {
    const state = await JobTracker.get(entityId);
    if (!state) return "missing";
    return state.filePath ? "already-real" : "still-sentinel";
  },
};
