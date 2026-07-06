import {
  calculateSalesReportAggregateFinancials,
  calculateSalesReportOrderFinancials,
  SalesReportOrderInput,
} from "../sales-report.repository";

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

jest.mock("../../../../../config/sequelize", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

const ICMS_SP_RATE = 0.073;
const CONTINENTAL_COMMISSION_RATE = 0.006;
const BARUM_COMMISSION_RATE = 0.003;

const calculateCommission = (base: number, rate: number) => base * rate;
const calculateProductCost = (averageCost: number, quantity: number) =>
  averageCost * quantity;
const calculateOrderItemTotalCost = (
  productCost: number,
  commission: number,
) => productCost + commission;
const calculateProfit = (revenue: number, cost: number) => revenue - cost;
const calculateContribution = (profit: number, revenue: number) =>
  revenue === 0 ? 0 : profit / revenue;
const calculateMarkup = (profit: number, cost: number) =>
  cost === 0 ? 0 : profit / cost;
const calculateAverageTicket = (revenue: number, ordersCount: number) =>
  ordersCount === 0 ? 0 : revenue / ordersCount;

const expectClose = (actual: number, expected: number) => {
  expect(actual).toBeCloseTo(expected, 6);
};

// ─── Dados mockados vindos do banco ───────────────────────────────────────────

const ordersFromDatabase: SalesReportOrderInput[] = [
  {
    id: "pedido-fisico-1",
    total_order: 1000,
    total_price: 950,
    freight_cost: 50,
    tax_commission: 0,
    icms_value: 950 * ICMS_SP_RATE,
    seller: { name: "Vendedor Loja" },
    items: [
      {
        sku: "continental-1",
        quantity: 2,
        average_cost_snapshot: 200,
        commission_base: 600,
        commission_rate: CONTINENTAL_COMMISSION_RATE,
        commission_value: calculateCommission(
          600,
          CONTINENTAL_COMMISSION_RATE,
        ),
        net_total: 600,
      },
      {
        sku: "barum-1",
        quantity: 1,
        average_cost_snapshot: 150,
        commission_base: 400,
        commission_rate: BARUM_COMMISSION_RATE,
        commission_value: calculateCommission(400, BARUM_COMMISSION_RATE),
        net_total: 400,
      },
    ],
  },
  {
    id: "pedido-fisico-2",
    total_order: 800,
    total_price: 800,
    freight_cost: 0,
    tax_commission: 0,
    icms_value: 800 * ICMS_SP_RATE,
    seller: { name: "Vendedor Loja" },
    items: [
      {
        sku: "continental-2",
        quantity: 1,
        average_cost_snapshot: 320,
        commission_base: 500,
        commission_rate: CONTINENTAL_COMMISSION_RATE,
        commission_value: calculateCommission(
          500,
          CONTINENTAL_COMMISSION_RATE,
        ),
        net_total: 500,
      },
      {
        sku: "barum-2",
        quantity: 2,
        average_cost_snapshot: 90,
        commission_base: 300,
        commission_rate: BARUM_COMMISSION_RATE,
        commission_value: calculateCommission(300, BARUM_COMMISSION_RATE),
        net_total: 300,
      },
    ],
  },
  {
    id: "pedido-online-bling",
    total_order: 470.35,
    total_price: 470.35 - 63.5 - 74.95,
    tax_commission: 63.5,
    freight_cost: 74.95,
    icms_value: (470.35 - 63.5 - 74.95) * ICMS_SP_RATE,
    seller: { name: "Vendedor 0" },
    items: [
      {
        sku: "continental-online",
        quantity: 1,
        average_cost_snapshot: 180,
        commission_base: 0,
        commission_rate: CONTINENTAL_COMMISSION_RATE,
        commission_value: 0,
        net_total: 470.35,
      },
    ],
  },
];

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("SalesReport financial calculations", () => {
  describe("itens de pedido", () => {
    it("calcula custo, comissão e lucro por item (sem rateio de comissão de marketplace ou frete)", () => {
      for (const order of ordersFromDatabase) {
        const result = calculateSalesReportOrderFinancials(order);
        expect(result).not.toBeNull();

        for (const item of order.items) {
          const actual = result!.items.find((row) => row.sku === item.sku);
          expect(actual).toBeDefined();

          const productCost = calculateProductCost(
            item.average_cost_snapshot!,
            item.quantity,
          );
          const commission = calculateCommission(
            item.commission_base ?? 0,
            item.commission_rate ?? 0,
          );
          const orderItemTotalCost = calculateOrderItemTotalCost(
            productCost,
            commission,
          );
          const productProfit = item.net_total - orderItemTotalCost;

          expectClose(actual!.productCost, productCost);
          expectClose(actual!.commission, commission);
          expectClose(actual!.orderItemTotalCost, orderItemTotalCost);
          expectClose(actual!.allocatedMarketplaceFee, 0);
          expectClose(actual!.allocatedFreightCost, 0);
          expectClose(actual!.productProfit, productProfit);
        }
      }
    });

    it("aplica a regra de marketplace do pedido online vindo do Bling", () => {
      const onlineOrder = ordersFromDatabase[2];
      const result = calculateSalesReportOrderFinancials(onlineOrder);

      expect(result).not.toBeNull();
      expect(result!.revenue).toBe(onlineOrder.total_price);
      expect(result!.revenue).not.toBe(onlineOrder.total_order);
      expect(result!.totalCommission).toBe(0);
      expectClose(result!.totalFees, onlineOrder.tax_commission!);
      expectClose(result!.totalTaxes, onlineOrder.total_price * ICMS_SP_RATE);

      const item = result!.items[0];
      expect(item.allocatedMarketplaceFee).toBe(0);
      expect(item.allocatedFreightCost).toBe(0);
    });
  });

  describe("pedido", () => {
    it("calcula receita, custo total, lucro, contribuição e markup", () => {
      for (const order of ordersFromDatabase) {
        const result = calculateSalesReportOrderFinancials(order);
        expect(result).not.toBeNull();

        const itemsCost = order.items.reduce((sum, item) => {
          const productCost = calculateProductCost(
            item.average_cost_snapshot!,
            item.quantity,
          );
          const commission = calculateCommission(
            item.commission_base ?? 0,
            item.commission_rate ?? 0,
          );
          return sum + calculateOrderItemTotalCost(productCost, commission);
        }, 0);
        const totalCost = itemsCost + (order.icms_value ?? 0);
        const profit = calculateProfit(order.total_price, totalCost);

        expectClose(result!.revenue, order.total_price);
        expectClose(result!.totalCost, totalCost);
        expectClose(result!.profit, profit);
        expectClose(result!.contributionValue, profit);
        expectClose(
          result!.contributionPct,
          calculateContribution(profit, order.total_price),
        );
        expectClose(result!.markup, calculateMarkup(profit, totalCost));
        expectClose(result!.markupPct, calculateMarkup(profit, totalCost) * 100);
      }
    });
  });

  describe("agregados", () => {
    it("calcula totais consolidados do relatório", () => {
      const aggregate =
        calculateSalesReportAggregateFinancials(ordersFromDatabase);
      const orderMetrics = ordersFromDatabase.map((order) =>
        calculateSalesReportOrderFinancials(order),
      );

      const totalValue = orderMetrics.reduce(
        (sum, order) => sum + order!.revenue,
        0,
      );
      const totalCost = orderMetrics.reduce(
        (sum, order) => sum + order!.totalCost,
        0,
      );
      const totalProfit = orderMetrics.reduce(
        (sum, order) => sum + order!.profit,
        0,
      );

      expect(aggregate.orders_count).toBe(3);
      expectClose(
        aggregate.items_quantity,
        orderMetrics.reduce((sum, order) => sum + order!.itemsQuantity, 0),
      );
      expectClose(aggregate.total_value, totalValue);
      expectClose(aggregate.total_cost, totalCost);
      expectClose(aggregate.total_profit, totalProfit);
      expectClose(
        aggregate.total_commission,
        orderMetrics.reduce((sum, order) => sum + order!.totalCommission, 0),
      );
      expectClose(
        aggregate.total_taxes,
        orderMetrics.reduce((sum, order) => sum + order!.totalTaxes, 0),
      );
      expectClose(
        aggregate.total_fees,
        orderMetrics.reduce((sum, order) => sum + order!.totalFees, 0),
      );
      expectClose(aggregate.contribution_value, totalProfit);
      expectClose(
        aggregate.contribution_pct,
        calculateContribution(totalProfit, totalValue),
      );
      expectClose(aggregate.markup, calculateMarkup(totalProfit, totalCost));
      expectClose(
        aggregate.markup_pct,
        calculateMarkup(totalProfit, totalCost) * 100,
      );
      expectClose(
        aggregate.average_ticket,
        calculateAverageTicket(totalValue, ordersFromDatabase.length),
      );
    });
  });
});