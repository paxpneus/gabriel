import {
  divScaled,
  formatScaled,
  mulScaled,
  rescale,
  toScaled,
} from "../decimal";
import {
  blingEntryPriceOrNull,
  parseBlingEntryPrice,
  weightedAveragePrice,
} from "../bling/stock-entry-price";

describe("decimal", () => {
  it("converte string decimal pra BigInt sem perder precisão", () => {
    expect(toScaled("0.1")).toBe(1000n);
    expect(toScaled("1700.0000000000")).toBe(17000000n);
    expect(formatScaled(toScaled("0.1")! + toScaled("0.2")!)).toBe("0.3000");
  });

  it("arredonda meio pra cima e é simétrico pra negativos", () => {
    expect(toScaled("1.23455")).toBe(12346n);
    expect(toScaled("-1.23455")).toBe(-12346n);
    expect(formatScaled(-5n)).toBe("-0.0005");
  });

  it("retorna null pra vazio/inválido em vez de 0", () => {
    expect(toScaled("")).toBeNull();
    expect(toScaled("abc")).toBeNull();
    expect(toScaled(null)).toBeNull();
  });

  it("multiplica e divide em escala fixa", () => {
    expect(formatScaled(mulScaled(toScaled("3")!, toScaled("1.1")!))).toBe("3.3000");
    expect(formatScaled(divScaled(toScaled("10")!, toScaled("3")!))).toBe("3.3333");
    expect(formatScaled(rescale(toScaled("12.3456")!, 4, 2), 2)).toBe("12.35");
  });
});

describe("parseBlingEntryPrice", () => {
  it("converte preco com 10 casas sem parseFloat", () => {
    expect(parseBlingEntryPrice("1700.0000000000")).toEqual({
      status: "ok",
      value: "1700.0000",
    });
    expect(parseBlingEntryPrice("0.1000000001")).toEqual({
      status: "ok",
      value: "0.1000",
    });
  });

  it("ausente, vazio, zero e inválido nunca viram 0", () => {
    expect(parseBlingEntryPrice(undefined).status).toBe("missing");
    expect(parseBlingEntryPrice("").status).toBe("missing");
    expect(parseBlingEntryPrice("0.0000000000").status).toBe("zero");
    expect(parseBlingEntryPrice("abc").status).toBe("invalid");
    expect(blingEntryPriceOrNull("0.0000000000")).toBeNull();
    expect(blingEntryPriceOrNull("")).toBeNull();
  });
});

describe("weightedAveragePrice", () => {
  it("pondera pela quantidade", () => {
    expect(
      weightedAveragePrice([
        { quantity: 1, price: "10.0000" },
        { quantity: 3, price: "20.0000" },
      ]),
    ).toBe("17.5000");
  });

  it("ignora linhas sem preço e retorna null se nenhuma tiver", () => {
    expect(
      weightedAveragePrice([
        { quantity: 2, price: null },
        { quantity: 2, price: "8.0000" },
      ]),
    ).toBe("8.0000");
    expect(weightedAveragePrice([{ quantity: 2, price: null }])).toBeNull();
  });
});
