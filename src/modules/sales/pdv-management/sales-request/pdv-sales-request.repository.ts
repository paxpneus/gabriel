import { Op } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import PdvSalesRequest from "./pdv-sales-request.model";
import { TERMINAL_PDV_SALES_REQUEST_STATUSES } from "./pdv-sales-request.types";

export class PdvSalesRequestRepository extends BaseRepository<PdvSalesRequest> {
  constructor() {
    super(PdvSalesRequest);
  }

  async findActiveByOrderId(orderId: string): Promise<PdvSalesRequest | null> {
    return this.findOne({
      where: {
        order_id: orderId,
        status: { [Op.notIn]: TERMINAL_PDV_SALES_REQUEST_STATUSES },
      },
    });
  }

  // Checagem de duplicidade de comprovante — não escopa por status ativo de
  // propósito: um comprovante já usado numa solicitação FINISHED continua
  // sendo o mesmo comprovante, não pode ser reaproveitado numa nova.
  async findByReceiptFingerprint(
    fingerprint: string,
  ): Promise<PdvSalesRequest | null> {
    return this.findOne({ where: { payment_receipt_fingerprint: fingerprint } });
  }

  async findActiveBySaleOrTransferInvoiceId(
    invoiceId: string,
  ): Promise<PdvSalesRequest[]> {
    return this.findAll({
      where: {
        [Op.or]: [
          { sale_invoice_id: invoiceId },
          { transfer_invoice_id: invoiceId },
        ],
        status: { [Op.notIn]: TERMINAL_PDV_SALES_REQUEST_STATUSES },
      },
    });
  }
}

export default new PdvSalesRequestRepository();
