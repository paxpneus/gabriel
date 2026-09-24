import { FindOptions, Op } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Customer from "../../customers/customers.model";
import Order from "./orders.model";
import orderRepository, { OrderRepository } from "./orders.repository";
import invoiceService from "../../../warehouse/fiscal/invoices/invoice/invoice.service";
import integrationService from "../../../integrations/integrations/integrations.service";
import integrationOrderStatusMappingService from "../integration-order-status-mapping/integration-order-status-mapping.service";
import { getBlingIntegration } from "../../../handlers/bling/api/bling_api.service";
import {
  FullOrder,
  OrderSalesReportDetail,
  ShipTodayPendingDetailRow,
  ShipToDefineDetailRow,
} from "./orders.types";
import {
  QueryParams,
  PaginatedResult,
} from "../../../../shared/query/query.types";

const toNumber = (value: number | string | null | undefined): number =>
  value == null ? 0 : Number(value);

export class OrderService extends BaseService<Order, OrderRepository> {
  constructor() {
    super(orderRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: ["created_at"],
        sortDir: "DESC",
      },
      sortableFields: [
        "created_at",
        "date",
        "collection_date",
        "internal_status",
      ],
      stringFields: ["number_order_system"],
      searchFields: ["number_order_system"],
      customFields: {
        // filters[status] chega no vocabulário normalized_status (ex:
        // "CANCELADO", "ATENDIDO") — já resolvido pros external_status_id
        // (actual_situation) correspondentes em paginate(), antes do
        // QueryParser rodar, via integrationOrderStatusMappingService. Aqui
        // é só um IN direto no próprio campo actual_situation de Order —
        // não depende mais de sales_order_snapshots.
        status: (value) => {
          const values = Array.isArray(value) ? value : [value];

          return {
            actual_situation: { [Op.in]: values },
          };
        },
        human_verification: (value) => {
          if (value !== "true") return {};

          return {
            internal_status: "CANCELLED",
            actual_situation: "748772",
            reason_cancelled: {
              [Op.ne]: null,
            },
          };
        },
      },
    };
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<Order>> {
    const resolvedParams = await this.resolveStatusFilter(params);

    const result = await super.paginate(resolvedParams, {
      ...extraOptions,
      attributes: { exclude: ["source_payload"] },
      include: [
        ...((extraOptions?.include as any[]) ?? []),
        { model: Customer, as: "customer" },
      ],
    });

    const integrationIds = [
      ...new Set(result.data.map((order) => order.integrations_id)),
    ];
    const statusMappings =
      await integrationOrderStatusMappingService.findByIntegrations(
        integrationIds,
      );
    const displayNameByKey = new Map<string, string>(
      statusMappings.map((mapping) => [
        `${mapping.integration_id}:${mapping.external_status_id}`,
        mapping.display_name,
      ]),
    );

    const data = result.data.map((order) => {
      const plain = order.get({ plain: true }) as any;
      const key = `${plain.integrations_id}:${plain.actual_situation}`;

      return {
        ...plain,
        status: displayNameByKey.get(key) ?? plain.actual_situation ?? null,
      };
    });

    return { ...result, data: data as unknown as Order[] };
  }

  // Traduz filters[status] (normalized_status, ex: "CANCELADO") pros
  // external_status_id correspondentes ANTES do QueryParser rodar — o
  // customField "status" (queryConfig acima) só sabe fazer IN direto em
  // actual_situation, não conhece normalized_status.
  private async resolveStatusFilter(
    params: QueryParams,
  ): Promise<QueryParams> {
    const statusValue = params.filters?.status;
    if (!statusValue) return params;

    const normalizedStatuses = Array.isArray(statusValue)
      ? statusValue
      : [statusValue];
    const externalStatusIds =
      await integrationOrderStatusMappingService.findExternalStatusIdsByNormalizedStatus(
        normalizedStatuses,
      );

    // Sem match nenhum: mantém o filtro restritivo (zero pedidos), em vez
    // de o QueryParser descartar um array vazio e devolver a lista inteira.
    const UNMATCHABLE_STATUS_FILTER = "__no_matching_status__";

    return {
      ...params,
      filters: {
        ...params.filters,
        status: externalStatusIds.length
          ? externalStatusIds
          : [UNMATCHABLE_STATUS_FILTER],
      },
    };
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
    const orderData =
      await this.repository.findWithSalesReportSnapshot(orderId);

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

  async releaseWaitingAcceptanceForToday(): Promise<Order[]> {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setUTCHours(23, 59, 59, 999);

    const where = {
      waiting_acceptance: true,
      internal_status: "WAITING FOR NFE EMISSION",
      collection_date: {
        [Op.between]: [startOfToday, endOfToday],
      },
      createdAt: {
        [Op.between]: [startOfToday, endOfToday],
      },
    };

    // Seleciona antes do update pra saber exatamente quais pedidos foram
    // liberados — o caller precisa dessa lista pra retomar o agendamento de
    // NFe de cada um (ver MLOrderSyncQueue.resumeAfterAcceptance); só zerar
    // a flag no banco não faz isso sozinho.
    const affectedOrders = await this.findAll({ where });

    if (!affectedOrders.length) {
      console.log(
        `[OrdersService] Nenhum pedido encontrado para liberar geração de nota fiscal.`,
      );
      return [];
    }

    await this.repository.bulkUpdate({ waiting_acceptance: false }, { where });

    return affectedOrders;
  }

  // ─── Resumo de status ─────────────────────────────────────────────────────
  // unitBusinessId só é usado por countShipTodayPending (escopa QUEM
  // gerou o lote — batch_generated é por filial) — ver o comentário no
  // topo de orders.repository.ts: pedidos de marketplace (Mercado Livre
  // incluso) não têm unit_business_id preenchido no pedido em si, então
  // nenhum outro método deste resumo escopa por unit business.

  // Contadores de humanVerification/shipToday/shipToDefine/shipToFuture são específicos
  // do fluxo Mercado Livre → só fazem sentido pra integração Bling (ver validação abaixo).
  async getOrdersStatusSummary(unitBusinessId: string) {
    const [integration, blingIntegration] = await Promise.all([
      integrationService.getIntegrationByUnitBusiness(unitBusinessId),
      getBlingIntegration(),
    ]);
    const isBlingUnitBusiness = integration?.name === blingIntegration.name;

    const pendingBatchByTransporter =
      await invoiceService.getPendingBatchByTransporter(unitBusinessId);

    const pendingBatchByTransporterSummary = pendingBatchByTransporter.map(
      ({ transporter_id, transporter_name, quantity }) => {
        const name = transporter_name ?? "Sem transportadora";
        return {
          transporter_id,
          label: `${name}`,
          highlighted_words: [name],
          label_color: "blue",
          quantity,
        };
      },
    );

    if (!isBlingUnitBusiness) {
      return {
        pending_batch_by_transporter: pendingBatchByTransporterSummary,
      };
    }

    const [
      mlHumanVerification,
      mlShipTodayPending,
      mlShipToDefine,
      mlShipToFuture,
    ] = await Promise.all([
      this.repository.countHumanVerification(),
      this.repository.countShipTodayPending(unitBusinessId),
      this.repository.countShipToDefine(),
      this.repository.countShipToFuture(),
    ]);

    return {
      human_verification: {
        label: "Verificação Humana",
        quantity: mlHumanVerification,
      },
      // highlighted_words: substrings de `label` que o frontend deve
      // destacar em negrito + label_color — os dois contadores abaixo são
      // especificamente sobre pedidos Mercado Livre.
      ship_today_pending: {
        label: "Embarques Hoje ML",
        highlighted_words: ["ML"],
        label_color: "yellow",
        quantity: mlShipTodayPending,
      },
      ship_to_define: {
        label: "Pendentes Automação ML",
        highlighted_words: ["ML"],
        label_color: "yellow",
        quantity: mlShipToDefine,
      },
      ship_to_future: {
        label: "Embarque Futuro ML",
        quantity: mlShipToFuture,
      },
      pending_batch_by_transporter: pendingBatchByTransporterSummary,
    };
  }

  async getShipTodayPendingDetail(
    unitBusinessId: string,
  ): Promise<ShipTodayPendingDetailRow[]> {
    return this.repository.findShipTodayPendingDetail(unitBusinessId);
  }

  async getShipToDefineDetail(): Promise<ShipToDefineDetailRow[]> {
    return this.repository.findShipToDefineDetail();
  }

  async getHumanVerificationDetail(): Promise<Record<string, number>> {
    const rows = await this.repository.groupHumanVerificationByReason();

    return rows.reduce<Record<string, number>>((acc, { reason, quantity }) => {
      acc[reason ?? "UNSET"] = quantity;
      return acc;
    }, {});
  }

  async getShipToFutureDetail(): Promise<Record<string, number>> {
    const rows = await this.repository.groupShipToFutureByDate();

    return rows.reduce<Record<string, number>>((acc, { date, quantity }) => {
      acc[date] = quantity;
      return acc;
    }, {});
  }

  async findByIdWithPaymentMethod(orderId: string): Promise<Order | null> {
    return this.repository.findByIdWithPaymentMethod(orderId);
  }

  async findEligibleForPdvByUnitBusiness(
    unitBusinessId: string | string[],
    limit: number,
  ): Promise<Order[]> {
    return this.repository.findEligibleForPdvByUnitBusiness(
      unitBusinessId,
      limit,
    );
  }

  async findByIdWithFullDetail(orderId: string): Promise<Order | null> {
    return this.repository.findByIdWithFullDetail(orderId);
  }
}

export default new OrderService();
