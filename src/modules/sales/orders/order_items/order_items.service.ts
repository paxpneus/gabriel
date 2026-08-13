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
import { Product } from "../../../inventory";
import Contact from "../../contacts/contacts.model";
import Customer from "../../customers/customers.model";
import { OrderSalesDetailRow, SalesDetailFilters } from "./order_items.types";
import Brand from "../../../inventory/brands/brands.model";
import { formatToBRISOString } from "../../../../shared/utils/normalizers/date";
import SellerSalesOrderItemSnapshot from "../../../reports/sellers-report/models/seller-sales-order-item-snapshot/seller-sales-order-item-snapshot.model";
import integrationsService from "../../../integrations/integrations/integrations.service";
import integrationMappingService from "../../../integrations/integration-mapping/integration-mapping.service";

const VENDEDOR_NAO_ATRIBUIDO = "Vendedor 0";

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

  // ─── Integração Tecinco: cacheia o id pra não buscar toda vez ───────────

  private async resolveIntegrationId(name: string): Promise<string | null> {
    const integration = await integrationsService.getFullIntegration({
      where: { name: name },
    });

    if (!integration || !integration.id) {
      console.warn(
        `[OrderItemsService] Integração ${name} não encontrada — id_vendedor_tecinco ficará null.`,
      );
      return null;
    }

    return integration.id;
  }

  async paginateSalesDetail(
    params: QueryParams,
    filters: SalesDetailFilters,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<OrderSalesDetailRow>> {
    const orderWhere: WhereOptions = {
      // ─── Regra fixa: pedido sem NFe vinculada não entra no relatório.
      invoice_id: { [Op.ne]: null },
    };
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

    const result = await super.paginate(
      mergedParams,
      {
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
              {
                model: Contact,
                as: "seller",
                attributes: ["id", "name"],
                required: true,
                where: { name: { [Op.ne]: VENDEDOR_NAO_ATRIBUIDO } },
              },
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
            include: [{ model: Brand, as: "brandRegister" }],
          },
          {
            model: SellerSalesOrderItemSnapshot,
            as: "sellerSnapshot",
            required: true,
            attributes: [
              "average_cost",
              "total_cost",
              "net_total",
              "icms_value_allocated",
              "tax_commission_allocated",
              "freight_cost_allocated",
              "contribution_value",
            ],
          },
        ],
      },
      {
        average_cost_snapshot: {
          [Op.and]: [{ [Op.ne]: null }, { [Op.ne]: 0 }],
        },
      },
    );

    const orderIds = [
      ...new Set(result.data.map((item: any) => item.order_id)),
    ];

    if (!orderIds.length) {
      return {
        ...result,
        data: [],
      } as unknown as PaginatedResult<OrderSalesDetailRow>;
    }

    const orderAggregatesRaw = await SellerSalesOrderItemSnapshot.findAll({
      attributes: [
        "order_id",
        [fn("SUM", col("contribution_value")), "contribution_sum"],
        [fn("SUM", col("freight_cost_allocated")), "freight_sum"],
        [fn("SUM", col("icms_value_allocated")), "icms_sum"],
      ],
      where: { order_id: orderIds },
      group: ["order_id"],
      raw: true,
    });

    const orderAggregatesMap = new Map<
      string,
      { contribution: number; freight: number; icms: number }
    >(
      orderAggregatesRaw.map((row: any) => [
        row.order_id,
        {
          contribution: Number(row.contribution_sum ?? 0),
          freight: Number(row.freight_sum ?? 0),
          icms: Number(row.icms_sum ?? 0),
        },
      ]),
    );

    // ─── Resolve integrações (Tecinco p/ vendedor, todas p/ produto) ──────
    const tecincoIntegrationId = await this.resolveIntegrationId("Tecinco");

    if (!tecincoIntegrationId) {
      throw new Error("Integração não resolvida");
    }

    const productIds = [
      ...new Set(
        result.data
          .map((item: any) => item.product_id)
          .filter((id: any) => !!id),
      ),
    ] as string[];

    const sellerContactIds = [
      ...new Set(
        result.data
          .map((item: any) => item.order?.seller?.id)
          .filter((id: any) => !!id),
      ),
    ] as string[];

    const [productIntegrationMappingsMap, sellerExternalIdsMap] =
      await Promise.all([
        integrationMappingService.findGroupedMappingsMap("PRODUCT", productIds),
        integrationMappingService.findExternalIdsMap(
          "CONTACT",
          tecincoIntegrationId,
          sellerContactIds,
        ),
      ]);

    const data: OrderSalesDetailRow[] = result.data.map((item: any) => {
      const order = item.order;
      const snapshot = item.sellerSnapshot;
      const orderAggregates = orderAggregatesMap.get(item.order_id) ?? {
        contribution: 0,
        freight: 0,
        icms: 0,
      };

      const sellerName = order?.seller?.name ?? null;
      const commissionValue =
        sellerName === VENDEDOR_NAO_ATRIBUIDO
          ? null
          : Number(item.commission_value ?? 0);

      const measure = item.product?.measure ?? "";
      const [, largura, perfil, aro] =
        measure.match(/^(\d+)\/(\d+)R(\d+)$/i) ?? [];

      const averageCost =
        snapshot?.average_cost != null ? Number(snapshot.average_cost) : null;

      const idVendedorTecinco = order?.seller?.id
        ? (sellerExternalIdsMap.get(order.seller.id) ?? null)
        : null;

      const integracoesProduto = item.product_id
        ? (productIntegrationMappingsMap.get(item.product_id) ?? [])
        : [];

      const integration_data_normalized = integracoesProduto.map((i) => {
        return {
          nome_integracao: i.integration_name,
          id_integracao: i.integration_id,
        };
      });

      return {
        pedido: {
          data_atualizacao: formatToBRISOString(order?.updatedAt),
          data_pedido: order?.date,
          numero_pedido: order?.number_order_system ?? null,
          valor_total_pedido: Number(order?.total_products ?? 0),
          custo_total_pedido: Number(order.total_cost),
          numero_nota_fiscal: order?.invoice?.number_system ?? null,
          lucro_pedido: Number(orderAggregates.contribution.toFixed(2)),
          total_frete_pedido: Number(orderAggregates.freight.toFixed(2)),
          total_icms_pedido: Number(orderAggregates.icms.toFixed(2)),
        },
        vendedor: {
          id_vendedor_tecinco: idVendedorTecinco,
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
            integracoes: integration_data_normalized,
            nome: item.product?.name ?? null,
            ean: item.product?.ean ?? null,
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
            valor_venda_item_liquido_rateado: Number(snapshot?.net_total ?? 0),
            custo_medio: averageCost,
            custo_total_item_pedido:
              averageCost != null
                ? Number((averageCost * Number(item.quantity ?? 0)).toFixed(2))
                : null,
            custo_total_item_pedido_rateado: Number(snapshot?.total_cost ?? 0),
            lucro_item: Number(snapshot?.contribution_value ?? 0),
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
