import { couponOwnerReferenceDate } from "../order-coupons/helpers/owner-reference-date";
import { normalizeCouponCode } from "../coupons/helpers/normalize-coupon-code";
import { orderNetProductsAmount } from "../../orders/order/helpers/discount";

describe("couponOwnerReferenceDate", () => {
  const date = new Date("2026-10-10T03:00:00Z");

  it("usa o created_at quando a ingestão foi no dia do pedido", () => {
    const createdAt = new Date("2026-10-10T15:00:00Z");
    expect(couponOwnerReferenceDate({ date, createdAt })).toEqual(createdAt);
  });

  it("importação atrasada: limita ao fim do dia do pedido", () => {
    const createdAt = new Date("2026-10-15T15:00:00Z");
    expect(couponOwnerReferenceDate({ date, createdAt })).toEqual(new Date("2026-10-11T03:00:00Z"));
  });

  it("sem date: usa o created_at", () => {
    const createdAt = new Date("2026-10-15T15:00:00Z");
    expect(couponOwnerReferenceDate({ date: null, createdAt })).toEqual(createdAt);
  });
});

describe("normalizeCouponCode", () => {
  it("trim + uppercase", () => {
    expect(normalizeCouponCode("  primeiraCompraPax ")).toBe("PRIMEIRACOMPRAPAX");
  });
});

describe("orderNetProductsAmount", () => {
  it("desconto em reais", () => {
    expect(orderNetProductsAmount({ total_products: 1000, discount_value: 100, discount_type: "REAL" })).toBe(900);
  });

  it("desconto percentual", () => {
    expect(orderNetProductsAmount({ total_products: "1000", discount_value: "10", discount_type: "PERCENTUAL" })).toBe(900);
  });

  it("sem desconto", () => {
    expect(orderNetProductsAmount({ total_products: 250 })).toBe(250);
  });
});
