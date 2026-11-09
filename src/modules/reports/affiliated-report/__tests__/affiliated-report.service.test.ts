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

  it("returns only sale value, products and commission per order, with the commission total", async () => {
    repository.findOrders.mockResolvedValue([
      { order_id: "o1", order_date: "2026-10-05", order_number: "1001", total_sold: "100.10", commission: "5.01", products: [{ name: "Pneu A", quantity: 2 }] },
      { order_id: "o2", order_date: "2026-10-04", order_number: "1000", total_sold: "200.20", commission: "0.00", products: [{ name: "Pneu B", quantity: 1 }] },
    ]);

    const report = await service.getReport("user-1", "2026-10-01", "2026-10-31");

    expect(report?.summary).toEqual({ total_commission: 5.01 });
    expect(report?.orders).toEqual([
      { order_id: "o1", order_date: "2026-10-05", order_number: "1001", total_sold: 100.1, commission: 5.01, products: [{ name: "Pneu A", quantity: 2 }] },
      { order_id: "o2", order_date: "2026-10-04", order_number: "1000", total_sold: 200.2, commission: 0, products: [{ name: "Pneu B", quantity: 1 }] },
    ]);
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
