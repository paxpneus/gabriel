import { buildMeasureNameRegex, buildTokenRegex } from "../tire-search";

// Mesma regex roda no Postgres (`~*`); aqui valida a semântica em JS (case-insensitive).
const matchesMeasure = (measure: string, name: string) =>
  new RegExp(buildMeasureNameRegex(measure), "i").test(name);

describe("buildMeasureNameRegex", () => {
  it("casa a medida exata no nome", () => {
    expect(matchesMeasure("12.5/80-18", "PNEU 12.5/80-18 R4 12PR SL TL PNEU CAMSO")).toBe(true);
  });

  it("não casa outra medida nem número colado nas bordas", () => {
    expect(matchesMeasure("12.5/80-18", "PNEU 12.4/80-18 R4 CAMSO")).toBe(false);
    expect(matchesMeasure("12.5/80-18", "PNEU 112.5/80-18 R4")).toBe(false);
    expect(matchesMeasure("12.5/80-18", "PNEU 12.5/80-180 R4")).toBe(false);
    expect(matchesMeasure("12.5/80-18", "PNEU 12.5/80-18.5 R4")).toBe(false);
  });

  it("tolera espaço em volta dos separadores e sufixo de letra", () => {
    expect(matchesMeasure("205/55R16", "PNEU 205/55 R16 91V")).toBe(true);
    expect(matchesMeasure("205/70R15", "PNEU 205/70R15LT 106R")).toBe(true);
    expect(matchesMeasure("205/55 r16", "pneu 205/55r16 91v")).toBe(true);
  });

  it("não troca separador (R vs -)", () => {
    expect(matchesMeasure("205/55R16", "PNEU 205/55-16")).toBe(false);
  });
});

describe("buildTokenRegex", () => {
  it("casa o índice como termo isolado", () => {
    expect(buildTokenRegex("R4").test(" R4 R3 12PR")).toBe(true);
    expect(buildTokenRegex("R4").test(" R44 12PR")).toBe(false);
    expect(buildTokenRegex("R4").test(" TR4 12PR")).toBe(false);
    expect(buildTokenRegex("91").test(" 91V")).toBe(true);
  });

  it("casa a marca no nome sem diferenciar maiúscula", () => {
    expect(buildTokenRegex("camso").test("PNEU 12PR SL TL PNEU CAMSO")).toBe(true);
  });
});
