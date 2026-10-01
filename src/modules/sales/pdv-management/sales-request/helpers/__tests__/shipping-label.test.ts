import { buildShippingLabel } from "../shipping-label";
import { PdvShippingType } from "../../pdv-sales-request.types";

describe("buildShippingLabel", () => {
  it("returns ADT CD 12 for the SP logistics transporter", () => {
    expect(
      buildShippingLabel(PdvShippingType.ADT, "LOGISTICA PAX PNEUS SP - CD 12"),
    ).toBe("ADT CD 12");
  });

  it("returns ADT CD 17 for the PR logistics transporter", () => {
    expect(
      buildShippingLabel(PdvShippingType.ADT, "LOGISTICA PAX PNEUS PR - CD 17"),
    ).toBe("ADT CD 17");
  });

  it("returns 'Embarque hoje' for TRANSPORTADORA regardless of transporter", () => {
    expect(
      buildShippingLabel(PdvShippingType.TRANSPORTADORA, "LOGISTICA PAX PNEUS SP - CD 12"),
    ).toBe("Embarque hoje");
    expect(buildShippingLabel(PdvShippingType.TRANSPORTADORA, null)).toBe(
      "Embarque hoje",
    );
  });

  it("returns null without shipping type", () => {
    expect(buildShippingLabel(null, "LOGISTICA PAX PNEUS SP - CD 12")).toBeNull();
  });

  it("returns plain ADT without transporter or without a CD in the name", () => {
    expect(buildShippingLabel(PdvShippingType.ADT, null)).toBe("ADT");
    expect(buildShippingLabel(PdvShippingType.ADT, "OUTRA TRANSPORTADORA")).toBe("ADT");
  });
});
