import { resolveSalesRequestOrigin } from "../sales-request-origin";
import { PdvSalesRequestOrigin } from "../../pdv-sales-request.types";
import { PdvAccessScreen } from "../../../pdv-access/pdv-access.types";

describe("resolveSalesRequestOrigin", () => {
  it("link de Televendas → TELEVENDAS", () => {
    expect(
      resolveSalesRequestOrigin({
        screen: PdvAccessScreen.STORE_REQUEST,
        via: "TELESALES_LINK",
        unitBusinessId: null,
      }),
    ).toBe(PdvSalesRequestOrigin.TELESALES);
  });

  it("link da loja solicitante → LOJA", () => {
    expect(
      resolveSalesRequestOrigin({
        screen: PdvAccessScreen.STORE_REQUEST,
        via: "STORE_LINK",
        unitBusinessId: "ub-1",
      }),
    ).toBe(PdvSalesRequestOrigin.STORE);
  });

  it("usuário logado em loja → LOJA", () => {
    expect(
      resolveSalesRequestOrigin({
        screen: PdvAccessScreen.STORE_REQUEST,
        via: "LOGIN",
        unitBusinessId: "ub-1",
        userId: "u-1",
      }),
    ).toBe(PdvSalesRequestOrigin.STORE);
  });

  it.each([PdvAccessScreen.FINANCE, PdvAccessScreen.CD21])(
    "%s não define origem",
    (screen) => {
      expect(
        resolveSalesRequestOrigin({ screen, via: "LOGIN", unitBusinessId: null }),
      ).toBeNull();
    },
  );
});
