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

// IMPORTANTE: states.icms_rate é armazenado como percentual puro (ex: 7.30 =
// 7,30%), não como fração decimal. calculateSalesReportOrderFinancials divide
// por 100 internamente ao calcular temp_icms — os testes usam o mesmo formato
// "cru" que vem do banco, pra pegar regressão caso essa divisão seja removida
// (era exatamente esse bug que fazia o contribution estourar pra -12mil).
const ICMS_RATE_SP = 7.3; // states.icms_rate WHERE acronym = 'SP'
const ICMS_RATE_BA = 14.8; // states.icms_rate WHERE acronym = 'BA'

const calculateProductCost = (averageCost: number, quantity: number) =>
  averageCost * quantity;

const calculateTempIcms = (
  totalProducts: number,
  discountValue: number,
  icmsRatePercent: number,
) => (totalProducts - discountValue) * (icmsRatePercent / 100);

const calculateProfit = (revenue: number, cost: number) => revenue - cost;

const calculateMarkup = (profit: number, cost: number) =>
  cost === 0 ? 0 : profit / cost;

const calculateContributionValue = (
  totalProducts: number,
  taxCommission: number,
  freightCost: number,
  tempIcms: number,
  totalCost: number,
) => totalProducts - taxCommission - freightCost - tempIcms - totalCost;

const calculatePct = (numerator: number, denominator: number) =>
  denominator === 0 ? 0 : numerator / denominator;

const calculateAverageTicket = (revenue: number, ordersCount: number) =>
  ordersCount === 0 ? 0 : revenue / ordersCount;

const expectClose = (actual: number, expected: number) => {
  expect(actual).toBeCloseTo(expected, 6);
};

// ─── Dados reais extraídos do banco (pedidos 12820 e 13026) ──────────────────

const ordersFromDatabase: SalesReportOrderInput[] = [
  // Pedido 12820 — Loja 22 Ourinhos/SP. 4x pneu Continental, sem desconto,
  // sem comissão de marketplace (tax_commission=0) e sem frete pago pela
  // empresa. total_cost_snapshot do item já vem pronto do banco
  // (average_cost_snapshot * quantity + commission_value = 328.1174*4 + 10.50
  // = 1322.97), então a função usa ele direto sem recalcular.
  {
    id: "pedido-12820",
    total_price: 1750.68,
    total_products: 1750.68,
    discount_value: 0,
    destination_uf: "SP",
    icms_rate: ICMS_RATE_SP,
    tax_commission: 0,
    freight_cost: 0,
    icms_value: 127.8, // icms de nota fiscal — só armazenado, não entra na conta
    seller: { name: "Vendedor Loja" },
    items: [
      {
        sku: "03135120000",
        quantity: 4,
        average_cost_snapshot: 328.1174,
        commission_base: 1750.68,
        commission_rate: 0.006,
        commission_value: 10.5,
        total_cost_snapshot: 1322.97,
        net_total: 1740.22,
      },
    ],
  },
  // Pedido 13026 — Teixeira de Freitas/BA. 1x pneu Continental, com desconto
  // de 155.98, com comissão de marketplace (tax_commission=89.69) e frete
  // pago pela empresa (freight_cost=78.65). Sem comissão de seller neste item
  // (commission_value=0).
  {
    id: "pedido-13026",
    total_price: 611.56,
    total_products: 779.9,
    discount_value: 155.98,
    destination_uf: "BA",
    icms_rate: ICMS_RATE_BA,
    tax_commission: 89.69,
    freight_cost: 78.65,
    icms_value: 90.51, // icms de nota fiscal — só armazenado, não entra na conta
    seller: { name: "Vendedor 0" },
    items: [
      {
        sku: "03573270000",
        quantity: 1,
        average_cost_snapshot: 541.7875,
        commission_base: 0,
        commission_rate: 0,
        commission_value: 0,
        total_cost_snapshot: 541.79,
        net_total: 779.9,
      },
    ],
  },
];

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("SalesReport financial calculations (regra nova: receita/custo bruto + contribution isolado)", () => {
  describe("itens de pedido", () => {
    it("usa total_cost_snapshot do banco como custo do item, sem somar ICMS", () => {
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
          const commission = item.commission_value ?? 0;
          // orderItemTotalCost deve vir do total_cost_snapshot já gravado,
          // NÃO recalculado a partir de productCost + commission, já que
          // ambos batem neste fixture (só confirma que a função usa o raw).
          const orderItemTotalCost = item.total_cost_snapshot!;
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
  });

  describe("pedido 12820 (SP, sem desconto, sem comissão marketplace, sem frete)", () => {
    const order = ordersFromDatabase[0];
    const result = calculateSalesReportOrderFinancials(order);

    it("receita e custo são sempre os valores brutos (total_products / soma de total_cost_snapshot)", () => {
      expect(result).not.toBeNull();
      expectClose(result!.revenue, 1750.68);
      expectClose(result!.totalCost, 1322.97);
    });

    it("markup mede lucro bruto (receita - custo), sem descontar comissão/frete/ICMS", () => {
      const profit = calculateProfit(1750.68, 1322.97);
      expectClose(result!.profit, profit);
      expectClose(result!.markup, calculateMarkup(profit, 1322.97));
      expectClose(result!.markupPct, calculateMarkup(profit, 1322.97) * 100);
      // markup esperado ~32.33%, igual ao relatório de origem
      expect(result!.markupPct).toBeCloseTo(32.32, 1);
    });

    it("contribution desconta tax_commission, freight_cost e ICMS calculado via alíquota do estado", () => {
      const tempIcms = calculateTempIcms(1750.68, 0, ICMS_RATE_SP);
      const contributionValue = calculateContributionValue(
        1750.68,
        0,
        0,
        tempIcms,
        1322.97,
      );

      expectClose(result!.contributionValue, contributionValue);
      expectClose(
        result!.contributionPct,
        calculatePct(contributionValue, 1750.68),
      );
      // com icms_rate=7.30 corretamente dividido por 100, o pedido deve dar
      // lucro positivo (~299.91) — é o caso que estava estourando pra -12mil
      // quando icms_rate era usado sem dividir por 100.
      expect(result!.contributionValue).toBeGreaterThan(0);
      expectClose(result!.contributionValue, 299.91036);
    });

    it("acumula temp_icms/tax_commission/freight_cost nos campos 'apenas guardando'", () => {
      const tempIcms = calculateTempIcms(1750.68, 0, ICMS_RATE_SP);
      expectClose(result!.totalTaxes, tempIcms);
      expectClose(result!.totalFees, 0);
      expectClose(result!.totalFreight, 0);
    });
  });

  describe("pedido 13026 (BA, com desconto, comissão marketplace e frete)", () => {
    const order = ordersFromDatabase[1];
    const result = calculateSalesReportOrderFinancials(order);

    it("receita e custo são sempre os valores brutos (total_products / soma de total_cost_snapshot)", () => {
      expect(result).not.toBeNull();
      expectClose(result!.revenue, 779.9);
      expectClose(result!.totalCost, 541.79);
    });

    it("markup mede lucro bruto, ignorando desconto/comissão/frete/ICMS", () => {
      const profit = calculateProfit(779.9, 541.79);
      expectClose(result!.profit, profit);
      expectClose(result!.markup, calculateMarkup(profit, 541.79));
      // markup esperado ~43.95%
      expect(result!.markupPct).toBeCloseTo(43.95, 1);
    });

    it("contribution dá prejuízo mesmo com markup positivo, por causa do desconto + comissão + frete + ICMS", () => {
      const tempIcms = calculateTempIcms(779.9, 155.98, ICMS_RATE_BA);
      const contributionValue = calculateContributionValue(
        779.9,
        89.69,
        78.65,
        tempIcms,
        541.79,
      );

      expectClose(result!.contributionValue, contributionValue);
      // contribution esperado ~ -22.57 (prejuízo), enquanto markup é +43.95%
      expect(result!.contributionValue).toBeLessThan(0);
      expectClose(result!.contributionValue, -22.57016);
    });

    it("acumula temp_icms/tax_commission/freight_cost nos campos 'apenas guardando'", () => {
      const tempIcms = calculateTempIcms(779.9, 155.98, ICMS_RATE_BA);
      expectClose(result!.totalTaxes, tempIcms);
      expectClose(result!.totalFees, 89.69);
      expectClose(result!.totalFreight, 78.65);
    });
  });

  describe("agregados (summary)", () => {
    it("soma receita/custo/lucro bruto de todos os pedidos, e contribution separadamente", () => {
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
      const totalContribution = orderMetrics.reduce(
        (sum, order) => sum + order!.contributionValue,
        0,
      );

      expect(aggregate.orders_count).toBe(2);
      expectClose(
        aggregate.items_quantity,
        orderMetrics.reduce((sum, order) => sum + order!.itemsQuantity, 0),
      );
      expectClose(aggregate.total_value, totalValue);
      expectClose(aggregate.total_cost, totalCost);
      expectClose(aggregate.total_profit, totalProfit);

      // contribution agregado é a SOMA dos contributions por pedido — não é
      // recalculado a partir dos totais agregados de receita/custo/frete.
      expectClose(aggregate.contribution_value, totalContribution);
      expectClose(
        aggregate.contribution_pct,
        calculatePct(totalContribution, totalValue),
      );

      // markup agregado usa profit bruto (receita-custo), igual à regra por
      // pedido — não usa contribution.
      expectClose(aggregate.markup, calculateMarkup(totalProfit, totalCost));
      expectClose(
        aggregate.markup_pct,
        calculateMarkup(totalProfit, totalCost) * 100,
      );

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
      expectClose(
        aggregate.total_freight,
        orderMetrics.reduce((sum, order) => sum + order!.totalFreight, 0),
      );
      expectClose(
        aggregate.average_ticket,
        calculateAverageTicket(totalValue, ordersFromDatabase.length),
      );
    });
  });
});