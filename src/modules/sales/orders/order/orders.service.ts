import { FindOptions, Op, literal } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Customer from "../../customers/customers.model";
import SalesOrderSnapshot from "../../../reports/daily-sales/sales-order-snapshot/sales-order-snapshot.model";
import Order from "./orders.model";
import orderRepository, { OrderRepository } from "./orders.repository";
import { FullOrder, OrderSalesReportDetail } from "./orders.types";
import { QueryParams, PaginatedResult } from "../../../../shared/query/query.types";

const toNumber = (value: number | string | null | undefined): number =>
  value == null ? 0 : Number(value);

export class OrderService extends BaseService<Order, OrderRepository> {
  constructor() {
    super(orderRepository);

     this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: ['created_at'],
        sortDir: 'DESC',
      },
      sortableFields: ['created_at', 'date', 'collection_date', 'internal_status'],
      stringFields: ['number_order_system'],
      searchFields: ['number_order_system'],
      customFields: {
        // filters[status] filtra pelo status_snapshot congelado em
        // sales_order_snapshots (gerado pelo job do relatório de vendas),
        // não por nenhum campo de orders.
        status: (value) => {
          const values = Array.isArray(value) ? value : [value];
          const escapedValues = values
            .map((v) => `'${String(v).replace(/'/g, "''")}'`)
            .join(", ");

          return {
            id: {
              [Op.in]: literal(
                `(SELECT order_id FROM sales_order_snapshots WHERE status_snapshot IN (${escapedValues}))`,
              ),
            },
          };
        },
      },
    };
  }

  async paginate(params: QueryParams, extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">): Promise<PaginatedResult<Order>> {
      const result = await super.paginate(params, {
        ...extraOptions,
        attributes: {exclude: [
          'source_payload'
        ]},
        include: [
          ...(extraOptions?.include as any[] ?? []),
          {
            model: SalesOrderSnapshot,
            as: "salesSnapshot",
            attributes: ["status_snapshot"],
            required: false,
          },
          { model: Customer, as: "customer" },
        ],
      });

     
      const data = result.data.map((order) => {
        const { salesSnapshot, ...plain } = order.get({ plain: true }) as any;

        return {
          ...plain,
          status: salesSnapshot?.status_snapshot ?? plain.internal_status ?? null,
        };
      });

      return { ...result, data: data as unknown as Order[] };
  }

  async getFullOrder(id: string): Promise<FullOrder> {
    const orderData = await this.repository.findOne({
      where: { id },
      include: [
        {
          model: Customer,
          as: "customer",
        },
      ],
    });

    if (!orderData) throw new Error("Pedido não encontrado.");

    return orderData as unknown as Promise<FullOrder>;
  }

  async getOrderSalesReportDetail(
    orderId: string,
  ): Promise<OrderSalesReportDetail> {
    const orderData = await this.repository.findWithSalesReportSnapshot(
      orderId,
    );

    if (!orderData) throw new Error("Pedido não encontrado.");

    const snapshot = orderData.salesSnapshot;
    if (!snapshot) {
      throw new Error(
        "Pedido ainda não possui snapshot no relatório de vendas.",
      );
    }

    const { customer, salesSnapshot, ...order } = orderData;
    const { items = [], ...snapshotFields } = snapshot;

    return {
      order,
      customer: customer ?? null,
      grossPrice: toNumber(snapshotFields.total_products),
      profit: toNumber(snapshotFields.contribution_value),
      profitMargin: toNumber(snapshotFields.contribution_pct),
      markupPct: toNumber(snapshotFields.markup_pct),
      discount: toNumber(snapshotFields.discount_value),
      icms: toNumber(snapshotFields.computed_icms_value),
      commission: toNumber(snapshotFields.total_commission),
      totalCost: toNumber(snapshotFields.total_cost),
      totalTaxes: toNumber(snapshotFields.total_taxes),
      totalFees: toNumber(snapshotFields.total_fees),
      freightCost: toNumber(snapshotFields.freight_cost),
      taxCommission: toNumber(snapshotFields.tax_commission),
      marketplaceFee: toNumber(snapshotFields.marketplace_fee),
      paymentFee: toNumber(snapshotFields.payment_fee),
      snapshot: snapshotFields,
      items,
    };
  }

  async getFullOrdersByQuery(options: FindOptions): Promise<FullOrder[]> {
    const orderData = await this.repository.findAll(options);

    if (!orderData) throw new Error("Pedido não encontrado.");

    return orderData as unknown as Promise<FullOrder[]>;
  }

  async releaseWaitingAcceptanceForToday(): Promise<number> {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setUTCHours(23, 59, 59, 999);

    const [affectedCount] = await this.repository.bulkUpdate(
      {
        waiting_acceptance: false,
      },
      {
        where: {
          waiting_acceptance: true,
          internal_status: "WAITING FOR NFE EMISSION",
          collection_date: {
            [Op.between]: [startOfToday, endOfToday],
          },
          createdAt: {
            [Op.between]: [startOfToday, endOfToday],
          },
        },
      },
    );

    if (!affectedCount) {
      console.log(
        `[OrdersService] Nenhum pedido encontrado para liberar geração de nota fiscal.`,
      );
    }

    return affectedCount;
  }
}

export default new OrderService();
