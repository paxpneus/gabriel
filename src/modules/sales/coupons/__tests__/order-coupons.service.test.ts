// Comissão do afiliado congelada em order_coupons (registerFromMagento).

const mockTransaction = {} as any;

jest.mock("../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn() },
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

import sequelize from "../../../../config/sequelize";
import orderService from "../../orders/order/orders.service";
import couponService from "../coupons/coupons.service";
import contactCouponService from "../contact-coupons/contact-coupons.service";
import orderCouponRepository from "../order-coupons/order-coupons.repository";
import { OrderCouponService } from "../order-coupons/order-coupons.service";

const ORDER_ID = "order-1";
const COUPON = { id: "coupon-1", code: "AFI10", active: true };
const OWNER = { id: "cc-1", contact_id: "affiliate-1", coupon_id: "coupon-1", commission_rate: "5.00" };

const baseOrder = {
  id: ORDER_ID,
  date: new Date("2026-10-20T00:00:00Z"),
  createdAt: new Date("2026-10-20T15:00:00Z"),
  total_products: "1000.00",
  discount_value: "100.00",
  discount_type: "REAL",
};

describe("OrderCouponService.registerFromMagento", () => {
  let service: OrderCouponService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new OrderCouponService();
    (sequelize.transaction as jest.Mock).mockImplementation((cb: any) => cb(mockTransaction));
    (orderService.findById as jest.Mock).mockResolvedValue(baseOrder);
    (orderService.touch as jest.Mock).mockResolvedValue(undefined);
    (couponService.findOrCreateByCode as jest.Mock).mockResolvedValue(COUPON);
    (contactCouponService.findOwnerAt as jest.Mock).mockResolvedValue(OWNER);
    (orderCouponRepository.findByOrderAndCoupon as jest.Mock).mockResolvedValue(null);
    (orderCouponRepository.findAffiliatedByOrder as jest.Mock).mockResolvedValue(null);
    (orderCouponRepository.create as jest.Mock).mockImplementation(async (data: any) => data);
  });

  const register = () =>
    service.registerFromMagento({ orderId: ORDER_ID, couponCode: "afi10", discountAmount: 30 });

  it("cupom ativo com dono: grava afiliado, taxa e comissão sobre produtos − desconto", async () => {
    await register();

    expect(orderCouponRepository.create).toHaveBeenCalledWith(
      {
        order_id: ORDER_ID,
        coupon_id: COUPON.id,
        contact_coupon_id: OWNER.id,
        discount_amount: 30,
        commission_rate: 5,
        commission_amount: 45, // (1000 − 100) × 5%
      },
      { transaction: mockTransaction },
    );
    expect(orderService.touch).toHaveBeenCalledWith(ORDER_ID);
  });

  it("desconto PERCENTUAL do pedido entra na base", async () => {
    (orderService.findById as jest.Mock).mockResolvedValue({
      ...baseOrder,
      discount_value: "10",
      discount_type: "PERCENTUAL",
    });

    await register();

    expect(orderCouponRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ commission_amount: 45 }), // (1000 − 10% de 1000) × 5%
      expect.anything(),
    );
  });

  it("cupom inativo: grava só o desconto, sem afiliado nem comissão", async () => {
    (couponService.findOrCreateByCode as jest.Mock).mockResolvedValue({ ...COUPON, active: false });

    await register();

    expect(contactCouponService.findOwnerAt).not.toHaveBeenCalled();
    expect(orderCouponRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        contact_coupon_id: null,
        commission_rate: null,
        commission_amount: null,
        discount_amount: 30,
      }),
      expect.anything(),
    );
  });

  it("cupom sem dono na data: grava só o desconto", async () => {
    (contactCouponService.findOwnerAt as jest.Mock).mockResolvedValue(null);

    await register();

    expect(orderCouponRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ contact_coupon_id: null, commission_amount: null }),
      expect.anything(),
    );
  });

  it("linha pedido + cupom já existe: não recalcula nem bumpa o pedido", async () => {
    (orderCouponRepository.findByOrderAndCoupon as jest.Mock).mockResolvedValue({
      order_id: ORDER_ID,
      coupon_id: COUPON.id,
    });

    await expect(register()).resolves.toBeNull();

    expect(orderCouponRepository.create).not.toHaveBeenCalled();
    expect(orderService.touch).not.toHaveBeenCalled();
  });

  it("pedido já tem afiliado por outro cupom: grava sem comissão", async () => {
    (orderCouponRepository.findAffiliatedByOrder as jest.Mock).mockResolvedValue({
      order_id: ORDER_ID,
      coupon_id: "other-coupon",
      contact_coupon_id: "cc-other",
    });
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    await register();

    expect(orderCouponRepository.create).toHaveBeenCalledWith(
      expect.objectContaining({ contact_coupon_id: null, commission_amount: null }),
      expect.anything(),
    );
  });

  it("ingestão no mesmo dia: data de referência é o createdAt", async () => {
    await register();

    expect(contactCouponService.findOwnerAt).toHaveBeenCalledWith(
      COUPON.id,
      new Date("2026-10-20T15:00:00Z"),
      mockTransaction,
    );
  });

  it("ingestão atrasada: data de referência limitada ao fim do dia do pedido", async () => {
    (orderService.findById as jest.Mock).mockResolvedValue({
      ...baseOrder,
      createdAt: new Date("2026-10-25T10:00:00Z"),
    });

    await register();

    expect(contactCouponService.findOwnerAt).toHaveBeenCalledWith(
      COUPON.id,
      new Date("2026-10-21T00:00:00Z"),
      mockTransaction,
    );
  });

  it("pedido inexistente: lança", async () => {
    (orderService.findById as jest.Mock).mockResolvedValue(null);

    await expect(register()).rejects.toThrow(`Order ${ORDER_ID} not found`);
  });
});
