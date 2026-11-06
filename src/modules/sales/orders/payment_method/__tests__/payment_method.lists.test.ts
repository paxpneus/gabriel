jest.mock("../../../pdv-management/pdv-access/pdv-access.middleware", () => ({ pdvAccess: jest.fn(() => jest.fn()) }));

import controller from "../payment_method.controller";
import paymentMethodService from "../payment_method.service";
import { CARD_BRANDS } from "../../../../../shared/constants/card-brands";
import { MAX_INSTALLMENTS } from "../../../../../shared/constants/installments";

function fakeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe("payment_method — listas fixas pro front", () => {
  it("listCardBrands: código + nome de todas as bandeiras, sem keywords", () => {
    const brands = paymentMethodService.listCardBrands();
    expect(brands).toHaveLength(CARD_BRANDS.length);
    expect(brands[1]).toEqual({ code: 2, name: "Mastercard" });
    expect(brands.every((brand) => !("keywords" in brand))).toBe(true);
  });

  it("listInstallmentOptions: 1x até MAX_INSTALLMENTS, em ordem", () => {
    const options = paymentMethodService.listInstallmentOptions();
    expect(options).toHaveLength(MAX_INSTALLMENTS);
    expect(options[0]).toEqual({ value: 1, name: "1x" });
    expect(options[options.length - 1]).toEqual({ value: 12, name: "12x" });
  });

  it("GET /card-brands e /installments respondem { data }", async () => {
    const res = fakeRes();
    await controller.cardBrands({} as any, res);
    expect(res.json).toHaveBeenCalledWith({ data: paymentMethodService.listCardBrands() });

    const res2 = fakeRes();
    await controller.installments({} as any, res2);
    expect(res2.json).toHaveBeenCalledWith({ data: paymentMethodService.listInstallmentOptions() });
  });
});
