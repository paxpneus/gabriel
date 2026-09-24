import { Op } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import PdvSalesRequestReceipt from "./pdv-sales-request-receipt.model";

export class PdvSalesRequestReceiptRepository extends BaseRepository<PdvSalesRequestReceipt> {
  constructor() {
    super(PdvSalesRequestReceipt);
  }

  async findAllByRequestId(
    requestId: string,
  ): Promise<PdvSalesRequestReceipt[]> {
    return this.findAll({
      where: { pdv_sales_request_id: requestId },
      order: [["createdAt", "ASC"]],
    });
  }

  // Duplicidade é global — mesmo comprovante já usado em QUALQUER solicitação
  // (não só na mesma). excludeId evita que editar a análise de uma linha a
  // autobloqueie contra ela mesma.
  async findByFingerprint(
    fingerprint: string,
    excludeId?: string,
  ): Promise<PdvSalesRequestReceipt | null> {
    return this.findOne({
      where: excludeId
        ? { fingerprint, id: { [Op.ne]: excludeId } }
        : { fingerprint },
    });
  }
}

export default new PdvSalesRequestReceiptRepository();
