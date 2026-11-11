// SQL do parser é só Postgres; o sequelize de teste é sqlite, então usa instância postgres sem conexão.
jest.mock("../../../config/sequelize", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  return { __esModule: true, default: new Sequelize({ dialect: "postgres", logging: false }) };
});

import { Op } from "sequelize";
import { QueryParser } from "../query.parser";

// Payload que, interpolado cru, fechava o literal e virava "OR (1=1)" — trazia todas as notas.
const INJECTION = `2099-01-01'::date AT TIME ZONE 'America/Sao_Paulo') OR (1=1) OR "emitted_at" >= ('2099-01-01`;
const escaped = (value: string) => `'${value.replace(/'/g, "''")}'`;

// filters tipado como string|string[]; o range {start,end} chega assim do querystring.
const parse = (params: object, config: object = {}): any => QueryParser.parse(params as any, config as any);

// Range do filtro emitted_at (where(literal('"emitted_at"'), { [Op.gte]/[Op.lt]: literal })).
const emittedAtRange = (where: any) => where[Op.and][0].logic;

describe("QueryParser — filtro emitted_at (literal cru)", () => {
  it("range válido gera o mesmo SQL de antes", () => {
    const { where } = parse({ filters: { emitted_at: { start: "2026-10-12", end: "2026-10-19" } } });
    const range = emittedAtRange(where);
    expect(range[Op.gte].val).toBe("('2026-10-12'::date AT TIME ZONE 'America/Sao_Paulo')");
    expect(range[Op.lt].val).toBe(
      "(('2026-10-19'::date + INTERVAL '1 day') AT TIME ZONE 'America/Sao_Paulo')",
    );
  });

  it("start/end com SQL entram como string escapada, nunca como SQL", () => {
    const { where } = parse({ filters: { emitted_at: { start: INJECTION, end: INJECTION } } });
    const range = emittedAtRange(where);
    expect(range[Op.gte].val).toBe(`(${escaped(INJECTION)}::date AT TIME ZONE 'America/Sao_Paulo')`);
    expect(range[Op.lt].val).toBe(
      `((${escaped(INJECTION)}::date + INTERVAL '1 day') AT TIME ZONE 'America/Sao_Paulo')`,
    );
  });

  it("dia único válido continua com o mesmo SQL", () => {
    const { where } = parse({ filters: { emitted_at: "2026-10-19" } });
    expect(where[Op.and][0].logic[Op.gte].val).toBe(
      "('2026-10-19'::date AT TIME ZONE 'America/Sao_Paulo')",
    );
  });
});

describe("QueryParser — direção do ORDER BY", () => {
  const config = { defaults: { sortBy: ["number_system"], sortDir: ["ASC", "ASC"] } };

  it("direção válida é mantida", () => {
    expect(parse({ sortBy: "emitted_at", sortDir: "DESC" }, config).order).toEqual([
      ["emitted_at", "DESC"],
    ]);
  });

  it("direção inválida cai no default da config, mesmo quando o default é array", () => {
    expect(parse({ sortBy: "emitted_at", sortDir: "xyz" }, config).order).toEqual([
      ["emitted_at", "ASC"],
    ]);
  });

  it("SQL na direção nunca chega no ORDER BY", () => {
    const { order } = parse({ sortBy: "emitted_at", sortDir: "DESC; SELECT pg_sleep(5)" }, config);
    expect(order).toEqual([["emitted_at", "ASC"]]);
  });

  it("2ª direção inválida usa a 1ª (comportamento de antes)", () => {
    expect(parse({ sortBy: "emitted_at,createdAt", sortDir: "DESC,xx" }, config).order).toEqual([
      ["emitted_at", "DESC"],
      ["createdAt", "DESC"],
    ]);
  });

  it("fallback ainda aceita as direções NULLS que o Sequelize valida", () => {
    expect(parse({ sortBy: "emitted_at", sortDir: "DESC NULLS FIRST" }, config).order).toEqual([
      ["emitted_at", "DESC NULLS FIRST"],
    ]);
  });
});
