const mockTransaction = {} as any;
jest.mock("../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: any) => cb(mockTransaction)) },
}));

jest.mock("../../orders/order/orders.service", () => ({
  __esModule: true,
  default: { findById: jest.fn(), touch: jest.fn() },
}));

jest.mock("../coupons/coupons.service", () => ({
  __esModule: true,
  default: { findOrCreateByCode: jest.fn() },
}));

jest.mock("../contact-coupons/contact-coupons.service", () => ({
  __esModule: true,
  default: { findOwnerAt: jest.fn() },
}));

jest.mock("../order-coupons/order-coupons.repository", () => ({
  __esModule: true,
  default: {
    findByOrderAndCoupon: jest.fn(),
    findAffiliatedByOrder: jest.fn(),
    create: jest.fn(),
  },
}));

import orderService from "../../orders/order/orders.service";
import couponService from "../coupons/coupons.service";
import contactCouponService from "../contact-coupons/contact-coupons.service";
import orderCouponRepository from "../order-coupons/order-coupons.repository";
import { OrderCouponService } from "../order-coupons/order-coupons.service";

const order = {
  id: "order-1",
  date: new Date("2026-10-10T03:00:00Z"),
  createdAt: new Date("2026-10-10T15:00:00Z"),
  total_products: 1000,
  discount_value: 100,
  discount_type: "REAL",
};

describe("OrderCouponService.registerFromMagento", () => {
  const service = new OrderCouponService();
  const input = { orderId: "order-1", couponCode: "primeiracomprapax", discountAmount: 100 };

  beforeEach(() => {
    jest.clearAllMocks();
    (orderService.findById as jest.Mock).mockResolvedValue(order);
    (couponService.findOrCreateByCode as jest.Mock).mockResolvedValue({
      id: "coupon-1",
      code: "PRIMEIRACOMPRAPAX",
      active: true,
    });
    (contactCouponService.findOwnerAt as jest.Mock).mockResolvedValue({
      id: "cc-1",
      contact_id: "affiliate-1",
      commission_rate: "5.00",
    });
    (orderCouponRepository.findByOrderAndCoupon as jest.Mock).mockResolvedValue(null);
    (orderCouponRepository.findAffiliatedByOrder as jest.Mock).mockResolvedValue(null);
  });

  it("cupom ativo com dono: congela taxa e comissão sobre (produtos − desconto)", async () => {
    await service.registerFromMagento(input);

    expect(couponService.findOrCreateByCode).toHaveBeenCalledWith("primeiracomprapax", mockTransaction);
    expect(contactCouponService.findOwnerAt).toHaveBeenCalledWith("coupon-1", order.createdAt, mockTransaction);
    expect(orderCouponRepository.create).toHaveBeenCalledWith(
      {
        order_id: "order-1",
        coupon_id: "coupon-1",
        contact_coupon_id: "cc-1",
        discount_amount: 100,
        commission_rate: 5,
        commission_amount: 45,
      },
      { transaction: mockTransaction },
    );
    expect(orderService.touch).toHaveBeenCalledWith("order-1");
  });

  it("cupom inativo: grava só o desconto, sem procurar dono", async () => {
    (couponService.findOrCreateByCode as jest.Mock).mockResolvedValue({ id: "coupon-1", code: "X", active: false });

    await service.registerFromMagento(input);

    expect(contactCouponService.findOwnerAt).not.toHaveBeenCalled();
    expect(orderCouponRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ contact_coupon_id: null, commission_rate: null, commission_amount: null }),
      expect.anything(),
    );
  });

  it("cupom sem dono vigente (ex.: criado automaticamente): grava só o desconto", async () => {
    (contactCouponService.findOwnerAt as jest.Mock).mockResolvedValue(null);

    await service.registerFromMagento(input);

    expect(orderCouponRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ contact_coupon_id: null, commission_amount: null, discount_amount: 100 }),
      expect.anything(),
    );
  });

  it("já registrado: não recalcula nada", async () => {
    (orderCouponRepository.findByOrderAndCoupon as jest.Mock).mockResolvedValue({ order_id: "order-1" });

    await service.registerFromMagento(input);

    expect(orderCouponRepository.create).not.toHaveBeenCalled();
  });

  it("pedido já tem afiliado: segundo cupom com dono grava só o desconto", async () => {
    (orderCouponRepository.findAffiliatedByOrder as jest.Mock).mockResolvedValue({ coupon_id: "outro" });
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});

    await service.registerFromMagento(input);

    expect(orderCouponRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ contact_coupon_id: null, commission_amount: null }),
      expect.anything(),
    );
    warn.mockRestore();
  });

  it("desconto percentual do pedido entra na base", async () => {
    (orderService.findById as jest.Mock).mockResolvedValue({
      ...order,
      discount_value: 10,
      discount_type: "PERCENTUAL",
    });

    await service.registerFromMagento(input);

    expect(orderCouponRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ commission_amount: 45 }),
      expect.anything(),
    );
  });

  it("pedido inexistente lança erro", async () => {
    (orderService.findById as jest.Mock).mockResolvedValue(null);
    await expect(service.registerFromMagento(input)).rejects.toThrow("Order order-1 not found");
  });
});
