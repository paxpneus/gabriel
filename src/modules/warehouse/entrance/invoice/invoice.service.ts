import { FindOptions, Sequelize } from "sequelize";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../shared/query/query.types";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Invoice from "./invoice.model";
import invoiceRepository, { InvoiceRepository } from "./invoice.repository";
import UnitBusiness from "../../unit-business/unit-business.model";
import Transporter from "../../transporter/transporter.model";
import ExpeditionBatch from "../../expedition/batch/batch.model";
import ExpeditionBatchInvoice from "../../expedition/batch-invoices/batch-invoices.model";
import { InvoiceAttributes } from "./invoice.types";
import Store from "../../../sales/stores/stores.model";
import InvoiceItems from "../invoice-items/invoice-items.model";
export class InvoiceService extends BaseService<Invoice, InvoiceRepository> {
  constructor() {
    super(invoiceRepository);

    this.queryConfig = {
      stringFields: ["receiver_cnpj", "sender_cnpj", "customer_document"],
      defaults: {
        perPage: 20,
        sortBy: "emitted_at",
        sortDir: "DESC",
      },
      // Campos para busca textual (LIKE)
      searchFields: ["customer_name", "sender_name", "number_system"],
      // Campos permitidos para filtros exatos (WHERE field = value)
      // ADICIONADO: 'type' e 'customer_name' aqui
      filterableFields: [
        "type",
        "unit_business_id",
        "transporter_id",
        "receiver_cnpj",
        "receiver_name",
        "sender_name",
        "sender_cnpj",
        "batch_generated",
        "printed_label",
        "emitted_at",
        "status",
      ],
      sortableFields: [
        "customer_name",
        "createdAt",
        "emitted_at",
        "batch_generated",
        "printed_label",
        "type",
        "status"
      ],
    };
  }

  
  async findByIdFull(id: string, options?: FindOptions) {
    return await this.repository.getFullInvoice(id)
  }

  async paginate(
  params: QueryParams,
  extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
): Promise<PaginatedResult<Invoice>> {
  return super.paginate(params, {
    ...extraOptions,
    include: [
      {
        model: ExpeditionBatchInvoice,
        as: "batchInvoice",
        attributes: ["id"],
        include: [
          {
            model: ExpeditionBatch,
            as: "batch",
            attributes: ["number"],
          },
        ],
      },
      {
        model: UnitBusiness,
        as: "unitBusiness",
      },
      {
        model: Store,
        as: "store",
      },
      {
        model: Transporter,
        as: "transporter",
      },
      {
        model: InvoiceItems,
        as: "items",
        attributes: [
          "id",
          "quantity_expected",
          "quantity_received",
          "status",
        ],
      },
    ],
    attributes: {
      include: [
        [
          Sequelize.literal(`(
            SELECT COALESCE(SUM(quantity_expected), 0)
            FROM invoice_items
            WHERE invoice_items.invoice_id = "Invoice"."id"
          )`),
          "total_expected",
        ],
        [
          Sequelize.literal(`(
            SELECT COALESCE(SUM(quantity_received), 0)
            FROM invoice_items
            WHERE invoice_items.invoice_id = "Invoice"."id"
          )`),
          "total_received",
        ],
      ],
    },
  });
}

  async updateInvoicesOpen(ids: string[], data: Partial<InvoiceAttributes>) {
    return await Invoice.update(data, {
      where: { id: ids, status: "OPEN" },
    });
  }
}

export default new InvoiceService();
