import { AffiliatedReportService } from "../affiliated-report.service";
import { contactService } from "../../../sales/contacts";
import contactCouponService from "../../../sales/coupons/contact-coupons/contact-coupons.service";
import couponService from "../../../sales/coupons/coupons/coupons.service";

// Fachada de contacts carrega sellers.service (cadeia que abre Redis/BullMQ e não deixa o Jest sair).
jest.mock("../../../sales/contacts", () => ({
  __esModule: true,
  contactService: { findOne: jest.fn() },
}));
jest.mock("../../../sales/coupons/contact-coupons/contact-coupons.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock("../../../sales/coupons/coupons/coupons.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

describe("AffiliatedReportService", () => {
  const repository = { findOrders: jest.fn() };
  const service = new AffiliatedReportService(repository as any);

  beforeEach(() => {
    jest.clearAllMocks();
    (contactService.findOne as jest.Mock).mockResolvedValue({ id: "aff-1" });
    (contactCouponService.findAll as jest.Mock).mockResolvedValue([]);
    (couponService.findAll as jest.Mock).mockResolvedValue([]);
    repository.findOrders.mockResolvedValue([]);
  });

  it("returns null when the logged user has no affiliated contact", async () => {
    (contactService.findOne as jest.Mock).mockResolvedValue(null);

    await expect(service.getReport("user-1", "2026-10-01", "2026-10-31")).resolves.toBeNull();
    expect(repository.findOrders).not.toHaveBeenCalled();
  });

  it("scopes the orders by the logged user's affiliated contact", async () => {
    await service.getReport("user-1", "2026-10-01", "2026-10-31");

    expect(contactService.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user_id: "user-1", type: "AFFILIATED" } }),
    );
    expect(repository.findOrders).toHaveBeenCalledWith({
      affiliatedId: "aff-1",
      startDate: "2026-10-01",
      endDate: "2026-10-31",
    });
  });

  const item = (overrides: Record<string, unknown>) => ({
    product_id: "p1", name: "Pneu A", brand: "Marca", measure: "175/70R13",
    quantity: 1, gross_total: 0, net_total: 0, commission: 0, ...overrides,
  });
  const rows = [
    {
      order_id: "o1", order_date: "2026-11-03", order_number: "1001", coupon_code: "GABS10",
      gross_total: "100.00", net_total: "90.00", commission: "9.00", commission_rate: "10.00",
      invoiced: true,
      items: [
        item({ quantity: 2, gross_total: 60, net_total: 54, commission: 5.4 }),
        item({ product_id: "p2", name: "Pneu B", gross_total: 40, net_total: 36, commission: 3.6 }),
      ],
    },
    {
      order_id: "o2", order_date: "2026-11-01", order_number: "1000", coupon_code: "GABS10",
      gross_total: "50.10", net_total: "50.10", commission: "0.00", commission_rate: "10.00",
      invoiced: false,
      items: [item({ product_id: "p2", name: "Pneu B", quantity: 1, gross_total: 50.1, net_total: 50.1 })],
    },
  ];

  it("shows gross − discount = net and net × rate = commission per order, with invoiced flag", async () => {
    repository.findOrders.mockResolvedValue(rows);

    const report = await service.getReport("user-1", "2026-11-01", "2026-11-30");

    expect(report?.orders[0]).toEqual({
      order_id: "o1", order_date: "2026-11-03", order_number: "1001", coupon_code: "GABS10",
      gross_total: 100, discount_value: 10, net_total: 90,
      commission_rate: 10, commission: 9, invoiced: true,
      products: [{ name: "Pneu A", quantity: 2 }, { name: "Pneu B", quantity: 1 }],
    });
    expect(report?.orders[1]).toEqual(expect.objectContaining({ commission: 0, invoiced: false, discount_value: 0 }));
  });

  it("summary: commission_pct only over invoiced orders", async () => {
    repository.findOrders.mockResolvedValue(rows);

    const report = await service.getReport("user-1", "2026-11-01", "2026-11-30");

    expect(report?.summary).toEqual({
      orders_count: 2,
      gross_total: 150.1,
      discount_total: 10,
      net_total: 140.1,
      total_commission: 9,
      commission_pct: 10,
    });
  });

  it("evolution by day, week (Monday) and month", async () => {
    repository.findOrders.mockResolvedValue(rows);

    const report = await service.getReport("user-1", "2026-11-01", "2026-11-30");

    expect(report?.evolution.daily.map((point) => point.period)).toEqual(["2026-11-01", "2026-11-03"]);
    // 2026-11-01 é domingo (semana de 26/10); 03/11 é terça (semana de 02/11).
    expect(report?.evolution.weekly.map((point) => point.period)).toEqual(["2026-10-26", "2026-11-02"]);
    expect(report?.evolution.monthly).toEqual([
      { period: "2026-11-01", orders_count: 2, gross_total: 150.1, discount_total: 10, net_total: 140.1, commission: 9 },
    ]);
  });

  it("products summed across orders, by quantity desc; ranking and by_coupon", async () => {
    repository.findOrders.mockResolvedValue(rows);

    const report = await service.getReport("user-1", "2026-11-01", "2026-11-30");

    expect(report?.products).toEqual([
      { product_id: "p1", product_name: "Pneu A", product_brand: "Marca", product_measure: "175/70R13", quantity: 2, gross_total: 60, discount_value: 6, net_total: 54, commission_value: 5.4 },
      { product_id: "p2", product_name: "Pneu B", product_brand: "Marca", product_measure: "175/70R13", quantity: 2, gross_total: 90.1, discount_value: 4, net_total: 86.1, commission_value: 3.6 },
    ]);
    const pneuA = { product_id: "p1", product_name: "Pneu A", product_brand: "Marca", product_measure: "175/70R13", quantity: 2, commission_value: 5.4 };
    expect(report?.ranking).toEqual({ most_sold_product: pneuA, highest_commission_product: pneuA });
    expect(report?.by_coupon).toEqual([{ code: "GABS10", orders_count: 2, net_total: 140.1, commission: 9 }]);
  });

  it("empty period: zeros, no division by zero, null ranking", async () => {
    const report = await service.getReport("user-1", "2026-11-01", "2026-11-30");

    expect(report?.summary).toEqual(expect.objectContaining({ commission_pct: 0, orders_count: 0 }));
    expect(report?.ranking).toEqual({ most_sold_product: null, highest_commission_product: null });
    expect(report?.evolution).toEqual({ daily: [], weekly: [], monthly: [] });
  });

  it("lists only active coupons of active links, with their commission rate", async () => {
    (contactCouponService.findAll as jest.Mock).mockResolvedValue([
      { coupon_id: "c1", commission_rate: "5.00" },
      { coupon_id: "c2", commission_rate: "3.00" },
    ]);
    // c2 inativo: findAll com active: true não devolve.
    (couponService.findAll as jest.Mock).mockResolvedValue([{ id: "c1", code: "PROMO10" }]);

    const report = await service.getReport("user-1", "2026-10-01", "2026-10-31");

    expect(contactCouponService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { contact_id: "aff-1", active: true } }),
    );
    expect(couponService.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ active: true }) }),
    );
    expect(report?.coupons).toEqual([{ code: "PROMO10", commission_rate: 5 }]);
  });

  it("skips the coupon lookup when the affiliate has no active link", async () => {
    const report = await service.getReport("user-1", "2026-10-01", "2026-10-31");

    expect(couponService.findAll).not.toHaveBeenCalled();
    expect(report?.coupons).toEqual([]);
  });
});
