import { isWithinPhysicalStoreRange } from "../physical-numbered-unit-business";

describe("isWithinPhysicalStoreRange", () => {
  it("true pros extremos do range padrão (1-24)", () => {
    expect(isWithinPhysicalStoreRange("1")).toBe(true);
    expect(isWithinPhysicalStoreRange("24")).toBe(true);
  });

  it("false fora do range padrão", () => {
    expect(isWithinPhysicalStoreRange("0")).toBe(false);
    expect(isWithinPhysicalStoreRange("25")).toBe(false);
    expect(isWithinPhysicalStoreRange("100")).toBe(false);
  });

  it("false pra number null/vazio/não numérico", () => {
    expect(isWithinPhysicalStoreRange(null)).toBe(false);
    expect(isWithinPhysicalStoreRange(undefined)).toBe(false);
    expect(isWithinPhysicalStoreRange("")).toBe(false);
    expect(isWithinPhysicalStoreRange("abc")).toBe(false);
  });

  it("compara numericamente, não lexicograficamente (\"10\" < \"24\", não > por string)", () => {
    expect(isWithinPhysicalStoreRange("10")).toBe(true);
    expect(isWithinPhysicalStoreRange("9")).toBe(true);
  });

  it("aceita range customizado", () => {
    expect(isWithinPhysicalStoreRange("30", { min: 25, max: 40 })).toBe(true);
    expect(isWithinPhysicalStoreRange("24", { min: 25, max: 40 })).toBe(false);
  });
});
