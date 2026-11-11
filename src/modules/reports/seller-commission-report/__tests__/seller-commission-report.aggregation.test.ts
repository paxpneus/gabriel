import {
  buildReportRows,
  buildSummary,
} from "../services/main/seller-commission-report/seller-commission-report.aggregation";
import { SellerCommissionItemRow } from "../models/seller-commission-report.types";

const item = (overrides: Partial<SellerCommissionItemRow> = {}): SellerCommissionItemRow => ({
  order_item_id: "oi1",
  order_id: "o1",
  order_date: "2026-10-04",
  order_number: "P1",
  invoice_number: "1001",
  store_name: "Loja 10",
  seller_name: "Vendedor A",
  manager_names: "Gerente A",
  customer_name: "Cliente",
  brand: "Marca",
  product_name: "Pneu",
  sku: "SKU1",
  quantity: "2.0000",
  net_total: "100.10",
  commission_base: "90.20",
  commission_rate: "0.5000",
  commission_value: "0.45",
  manager_commission_rate: "0.2500",
  manager_commission_value: "0.23",
  regional_manager_names: "Regional A",
  regional_manager_commission_rate: "0.2500",
  regional_manager_commission_value: "0.23",
  affiliated_name: null,
  affiliated_commission_value: "0.00",
  ...overrides,
});

describe("buildReportRows / buildSummary", () => {
  it("linha leva a nota do pedido; resumo soma comissões de vendedor, gerente e regional", () => {
    // Loja sem regional: comissão regional 0, a do gerente da loja continua.
    const items = [
      item(),
      item({
        order_item_id: "oi2",
        commission_value: "0.10",
        manager_commission_value: "0.07",
        regional_manager_names: null,
        regional_manager_commission_rate: 0,
        regional_manager_commission_value: 0,
      }),
    ];

    const [row] = buildReportRows(items);
    expect(row).toMatchObject({
      invoice_number: "1001",
      manager_name: "Gerente A",
      quantity: 2,
      total_value: 100.1,
      seller_commission_rate: 0.5,
      seller_commission_value: 0.45,
      manager_commission_value: 0.23,
      regional_manager_name: "Regional A",
      regional_manager_commission_rate: 0.25,
      regional_manager_commission_value: 0.23,
    });
    expect(buildSummary(items)).toEqual({
      orders_count: 1,
      items_quantity: 4,
      total_value: 200.2,
      commission_base: 180.4,
      total_seller_commission: 0.55,
      total_manager_commission: 0.3,
      total_regional_manager_commission: 0.23,
      total_affiliated_commission: 0,
      total_commission: 1.08,
    });
  });

  it("pedido só de afiliado: sem vendedor, comissão do afiliado entra no total", () => {
    const items = [
      item({
        seller_name: null,
        commission_value: 0,
        manager_commission_value: 0,
        regional_manager_commission_value: 0,
        affiliated_name: "Afiliado A",
        affiliated_commission_value: "1.25",
      }),
    ];

    expect(buildReportRows(items)[0]).toMatchObject({
      seller_name: null,
      affiliated_name: "Afiliado A",
      affiliated_commission_value: 1.25,
    });
    expect(buildSummary(items)).toMatchObject({
      total_seller_commission: 0,
      total_affiliated_commission: 1.25,
      total_commission: 1.25,
    });
  });
});
