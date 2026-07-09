import { FindOptions, Op, WhereOptions, fn, col, OrderItem } from "sequelize";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../shared/query/query.types";
import BaseService from "../../../../shared/utils/base-models/base-service";
import OrderItems from "./order_items.model";
import orderItemsRepository, {
  OrderItemsRepository,
} from "./order_items.repository";
import Order from "../order/orders.model";
import { UnitBusiness, Invoice } from "../../../warehouse";
import { Product, ProductConfig } from "../../../inventory";
import Contact from "../../contacts/contacts.model";
import Customer from "../../customers/customers.model"; // ajustar path/nome se diferente
import { OrderSalesDetailRow, SalesDetailFilters } from "./order_items.types";
import Brand from "../../../inventory/brands/brands.model";
import { ProductConfigAttributes } from "../../../inventory/product-config/product_config.types";
import { formatToBRDate, formatToBRISOString } from "../../../../shared/utils/normalizers/date";

export class OrderItemsService extends BaseService<
  OrderItems,
  OrderItemsRepository
> {
  constructor() {
    super(orderItemsRepository);

    this.queryConfig = {
      defaults: { perPage: 50, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: ["sku", "name"],
      filterableFields: ["product_id", "order_id"],
      sortableFields: ["quantity", "net_total", "createdAt"],
      customSort: {
        "order.updated_at": (dir: "ASC" | "DESC") =>
          [{ model: Order, as: "order" }, "updated_at", dir] as OrderItem,
        "order.number_order_system": (dir: "ASC" | "DESC") =>
          [
            { model: Order, as: "order" },
            "number_order_system",
            dir,
          ] as OrderItem,
      },
    };
  }

  async paginateSalesDetail(
    params: QueryParams,
    filters: SalesDetailFilters,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<OrderSalesDetailRow>> {
    const orderWhere: WhereOptions = {};
    if (filters.startDate && filters.endDate) {
      orderWhere.date = { [Op.between]: [filters.startDate, filters.endDate] };
    }
    if (filters.unitBusinessId)
      orderWhere.unit_business_id = filters.unitBusinessId;
    if (filters.sellerId) orderWhere.seller_id = filters.sellerId;
    if (filters.customerId) orderWhere.customer_id = filters.customerId;
    if (filters.orderId) orderWhere.id = filters.orderId;

    const mergedParams: QueryParams = {
      ...params,
      sortBy: params.sortBy ?? "order.updated_at,order.number_order_system",
      sortDir: params.sortDir ?? "DESC,DESC",
      filters: {
        ...(params.filters ?? {}),
        ...(filters.productId ? { product_id: filters.productId } : {}),
      },
    };

    const result = await super.paginate(mergedParams, {
      ...extraOptions,
      include: [
        {
          model: Order,
          as: "order",
          required: true,
          where: orderWhere,
          attributes: [
            "id",
            "date",
            "number_order_system",
            "total_price",
            "total_cost",
            "total_products",
            "icms_value",
            "tax_commission",
            "freight_cost",
            "unit_business_id",
            "seller_id",
            "customer_id",
            "invoice_id",
            "updatedAt",
          ],
          include: [
            {
              model: UnitBusiness,
              where: { number: { [Op.ne]: null } },
              as: "unitBusiness",
              attributes: ["id", "name", "number", "cnpj"],
            },
            { model: Contact, as: "seller", attributes: ["id", "name"] },
            {
              model: Customer,
              as: "customer",
              attributes: ["id", "name", "document"],
            },
            {
              model: Invoice,
              as: "invoice",
              attributes: ["id", "number_system"],
            },
          ],
        },
        {
          model: Product,
          as: "product",
          attributes: ["id", "name", "ean", "ean_tribut", "line", "measure"],
          include: [
            { model: Brand, as: "brandRegister" },
            {
              model: ProductConfig,
              as: "productConfigs",
              separate: true,
              include: [
                {
                  model: UnitBusiness,
                  as: "unitBusiness",
                  where: { type: "PHYSICAL" },
                },
              ],
            },
          ],
        },
      ],
    });

    const orderIds = [
      ...new Set(result.data.map((item: any) => item.order_id)),
    ];

    if (!orderIds.length) {
      return {
        ...result,
        data: [],
      } as unknown as PaginatedResult<OrderSalesDetailRow>;
    }

    const orderTotalsRaw = await this.repository.findAll({
      attributes: ["order_id", [fn("SUM", col("net_total")), "net_total_sum"]],
      where: { order_id: orderIds },
      group: ["order_id"],
      raw: true,
    });

    const orderTotalsMap = new Map<string, number>(
      orderTotalsRaw.map((row: any) => [
        row.order_id,
        Number(row.net_total_sum ?? 0),
      ]),
    );

    const data: OrderSalesDetailRow[] = result.data.map((item: any) => {
      const order = item.order;
      const netTotalSum = orderTotalsMap.get(item.order_id) ?? 0;
      const weight =
        netTotalSum === 0 ? 0 : Number(item.net_total ?? 0) / netTotalSum;

      const icmsAllocated = Number(
        (weight * Number(order?.icms_value ?? 0)).toFixed(2),
      );
      const marketplaceTaxAllocated = Number(
        (weight * Number(order?.tax_commission ?? 0)).toFixed(2),
      );
      const freightAllocated = Number(
        (weight * Number(order?.freight_cost ?? 0)).toFixed(2),
      );
      const saleValueAllocated = Number(
        (weight * Number(order?.total_price ?? 0)).toFixed(2),
      );
      const cost = Number(item.total_cost_snapshot ?? 0);

      const profit = Number(
        (saleValueAllocated - cost - icmsAllocated).toFixed(2),
      );

      const sellerName = order?.seller?.name ?? null;
      const commissionValue =
        sellerName === "Vendedor 0" ? null : Number(item.commission_value ?? 0);

      console.log(order?.updatedAt);

      const measure = item.product?.measure ?? "";
      const [, largura, perfil, aro] =
        measure.match(/^(\d+)\/(\d+)R(\d+)$/i) ?? [];

      const productConfig = item.product?.productConfigs.find(
        (s: ProductConfigAttributes) =>
          s.unit_business_id == order?.unitBusiness?.id,
      );

      return {
        pedido: {
          data_atualizacao: formatToBRISOString(order?.updatedAt),
          data_pedido: order?.date,
          numero_pedido: order?.number_order_system ?? null,
          valor_total_pedido: Number(order?.total_products ?? 0),
          custo_total_pedido: Number(order.total_cost),
          numero_nota_fiscal: order?.invoice?.number_system ?? null,
        },
        vendedor: {
          id_vendedor_tecinco: "",
          nome_vendedor: sellerName,
        },
        loja: {
          id_loja_tecinco: Number(order?.unitBusiness?.number) ?? null,
          nome_loja: order?.unitBusiness?.name ?? null,
          numero_loja: order?.unitBusiness?.number ?? null,
          cnpj_loja: order?.unitBusiness?.cnpj ?? null,
        },
        produto: {
          identificacao: {
            nome: item.product?.name ?? null,
            ean: item.product?.ean ?? null,
            sku_tecinco: productConfig?.sku ?? null,
            sku_bling: item.sku,
            linha: item.product?.line ?? null,
          },

          medida: {
            completa: item.product?.measure ?? null,
            largura,
            perfil,
            aro,
          },

          precos: {
            quantidade: item.quantity,
            valor_venda_item: Number(item.price ?? 0),
            custo_medio: Number(item.average_cost_snapshot) ?? null,
            custo_total_item_pedido: cost,
            valor_premiacao_vendedor_item_pedido: commissionValue,
          },

          marca: {
            nome: item.product?.brandRegister?.name ?? null,
            premiacao_vendedor_pct:
              item.product?.brandRegister?.seller_comission_tax_rate ?? null,
            premiacao_gerente_pct:
              item.product?.brandRegister?.manager_comission_tax_rate ?? null,
          },
        },
        cliente: {
          nome_cliente: order?.customer?.name ?? null,
          documento_cliente: order?.customer?.document ?? null,
        },
      };
    });

    return {
      ...result,
      data,
    } as unknown as PaginatedResult<OrderSalesDetailRow>;
  }
}

export default new OrderItemsService();
