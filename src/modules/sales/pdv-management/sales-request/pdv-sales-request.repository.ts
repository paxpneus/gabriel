import { Op, WhereOptions } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import PdvSalesRequest from "./pdv-sales-request.model";
import {
  PdvSalesRequestStatus,
  TERMINAL_PDV_SALES_REQUEST_STATUSES,
} from "./pdv-sales-request.types";
import Order from "../../orders/order/orders.model";
import Customer from "../../customers/customers.model";
import PaymentMethod from "../../orders/payment_method/payment_method.model";
import OrderItems from "../../orders/order_items/order_items.model";
import UnitBusiness from "../../../company/unit-business/unit-business.model";
import Invoice from "../../../warehouse/fiscal/invoices/invoice/invoice.model";
import type {
  QueryParams,
  QueryConfig,
  PaginatedResult,
} from "../../../../shared/query/query.types";

// Só id/number_system — o front usa pra exibir o número da nota + montar a
// rota de DANFE (GET /:id/invoice/:invoiceId/danfe), nunca a nota inteira.
const INVOICE_SUMMARY_INCLUDE = [
  { model: Invoice, as: "saleInvoice", attributes: ["id", "number_system"] },
  { model: Invoice, as: "transferInvoice", attributes: ["id", "number_system"] },
];

export class PdvSalesRequestRepository extends BaseRepository<PdvSalesRequest> {
  constructor() {
    super(PdvSalesRequest);
  }

  // Pedido (Bling) embutido, com cliente/pagamento/itens — card expandido
  // do Kanban. `order` é associação própria (belongsTo), o resto é join
  // dela — ver .claude/entities/pdv-sales-request/index.md ("Card do Kanban").
  // `unitBusiness` no topo é a loja da PRÓPRIA solicitação (own
  // unit_business_id, distinta de order.unitBusiness) — só id/number.
  async findByIdWithOrder(id: string): Promise<PdvSalesRequest | null> {
    return this.findById(id, {
      include: [
        {
          model: Order,
          as: "order",
          include: [
            { model: Customer, as: "customer" },
            { model: PaymentMethod, as: "paymentMethod" },
            { model: UnitBusiness, as: "unitBusiness" },
            { model: OrderItems, as: "items" },
          ],
        },
        { model: UnitBusiness, as: "unitBusiness", attributes: ["id", "number"] },
        ...INVOICE_SUMMARY_INCLUDE,
      ],
    });
  }

  // Mesmo embed, versão resumida (sem pagamento/itens) pra listagem.
  async findPaginatedWithOrder(
    params: QueryParams,
    config: QueryConfig,
    forcedWhere?: WhereOptions,
  ): Promise<PaginatedResult<PdvSalesRequest>> {
    return this.findPaginated(
      params,
      config,
      {
        include: [
          {
            model: Order,
            as: "order",
            attributes: { exclude: ["source_payload"] },
            include: [
              { model: Customer, as: "customer" },
              { model: UnitBusiness, as: "unitBusiness" },
            ],
          },
          { model: UnitBusiness, as: "unitBusiness", attributes: ["id", "number"] },
          ...INVOICE_SUMMARY_INCLUDE,
        ],
      },
      forcedWhere,
    );
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

  // Candidatas ao auto-finish (finishIfDeliveryNoteGenerated) — status
  // restrito a SHIPPING de propósito, diferente do "ativo" genérico acima:
  // só faz sentido finalizar sozinho quem já está aguardando expedição.
  async findShippingBySaleOrTransferInvoiceIds(
    invoiceIds: string[],
  ): Promise<PdvSalesRequest[]> {
    if (!invoiceIds.length) return [];

    return this.findAll({
      where: {
        [Op.or]: [
          { sale_invoice_id: { [Op.in]: invoiceIds } },
          { transfer_invoice_id: { [Op.in]: invoiceIds } },
        ],
        status: PdvSalesRequestStatus.SHIPPING,
      },
    });
  }
}

export default new PdvSalesRequestRepository();
