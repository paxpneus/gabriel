import BaseService from "../../../../shared/utils/base-models/base-service";
import PdvSalesRequestReceipt from "./pdv-sales-request-receipt.model";
import pdvSalesRequestReceiptRepository, {
  PdvSalesRequestReceiptRepository,
} from "./pdv-sales-request-receipt.repository";

export class PdvSalesRequestReceiptService extends BaseService<
  PdvSalesRequestReceipt,
  PdvSalesRequestReceiptRepository
> {
  constructor() {
    super(pdvSalesRequestReceiptRepository);
  }

  async findAllByRequestId(
    requestId: string,
  ): Promise<PdvSalesRequestReceipt[]> {
    return this.repository.findAllByRequestId(requestId);
  }

  async deleteAllByRequestId(requestId: string): Promise<number> {
    return this.repository.deleteAllByRequestId(requestId);
  }

  async findByFingerprint(
    fingerprint: string,
    excludeId?: string,
  ): Promise<PdvSalesRequestReceipt | null> {
    return this.repository.findByFingerprint(fingerprint, excludeId);
  }
}

export default new PdvSalesRequestReceiptService();
