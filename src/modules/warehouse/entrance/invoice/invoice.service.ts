import { FindOptions, Op, Sequelize } from "sequelize";
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
import { getBrazilDate } from "../../../../shared/utils/normalizers/date";
export class InvoiceService extends BaseService<Invoice, InvoiceRepository> {
  constructor() {
    super(invoiceRepository);

    this.queryConfig = {
      stringFields: ["receiver_cnpj", "sender_cnpj", "customer_document"],
      defaults: {
        perPage: 20,
        sortBy: ["status", "number_system"],
        sortDir: ["ASC", "ASC"],
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
        "received_at",
        "expected_receiving",
        "batch_generated",
        "printed_label",
        "type",
        "status",
        "number_system",
      ],
      customFields: {
        batchStatus: (value) => ({
          "$batchInvoice.batch.status$": Array.isArray(value)
            ? { [Op.in]: value }
            : value,
        }),
      },
    };
  }

  async findByIdFull(id: string, options?: FindOptions) {
    return await this.repository.getFullInvoice(id);
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<Invoice>> {
    const hasBatchFilter = !!params.filters?.batchStatus;

    return super.paginate(params, {
      ...extraOptions,
      subQuery: false,
      include: [
        {
          model: ExpeditionBatchInvoice,
          as: "batchInvoice",
          required: hasBatchFilter,
          attributes: ["id"],
          include: [
            {
              model: ExpeditionBatch,
              as: "batch",
              required: hasBatchFilter,
              attributes: ["number", "status", "id"],
            },
          ],
        },
        {
          model: UnitBusiness,
          as: "unitBusiness",
          attributes: ["number", "name"],
        },
        {
          model: Store,
          as: "store",
          attributes: ["name"],
        },
        {
          model: Transporter,
          as: "transporter",
          attributes: ["name"],
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

  async scheduleInvoice(id: string, expectedDate: string) {

    if (!expectedDate) {
      throw new Error("Data inválida");
    }

    const formatToBrazilDate = (dateStr: string): string => {
      const [year, month, day] = dateStr.split("-");
      return `${day}${month}${year}`;
    };

    const todayBR = getBrazilDate();
    const expectedBR = formatToBrazilDate(expectedDate);

    if (expectedBR < todayBR) {
      throw new Error("Data inválida, não é possível agendar notas para dias anteriores a hoje!");
    }

    const invoice = await this.findById(id);
    if (!invoice) {
      throw new Error("Nota fiscal não encontrada");
    }

    if (["LATE", "FINISHED", "CANCELLED"].includes(invoice.status)) {
      throw new Error(
        "Status não permitido para alterar data prevista de entrega",
      );
    }

    await invoice.update({
      status: "SCHEDULED",
      expected_receiving: expectedDate,
    });
  }
}

export default new InvoiceService();
