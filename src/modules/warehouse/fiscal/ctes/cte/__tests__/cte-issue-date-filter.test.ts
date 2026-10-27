// SQL do filtro é só Postgres; o sequelize de teste é sqlite, então usa instância postgres sem conexão.
jest.mock("../../../../../../config/sequelize", () => {
  const { Sequelize } = jest.requireActual("sequelize");
  return { __esModule: true, default: new Sequelize({ dialect: "postgres", logging: false }) };
});

import { Op } from "sequelize";
import cteService from "../services/cte.service";

// Payload que, interpolado cru, virava "OR (1=1)" e trazia todos os CT-es.
const INJECTION = `2099-01-01'::date AT TIME ZONE 'America/Sao_Paulo') OR (1=1) OR "issue_date" >= ('2099-01-01`;
const issueDate = (value: unknown) =>
  (cteService.getQueryConfig().customFields!.issue_date(value as any) as any)[Op.and][0].logic;

describe("CT-e filters[issue_date]", () => {
  it("range válido gera o mesmo SQL de antes", () => {
    const range = issueDate({ start: "2026-09-06", end: "2026-10-06" });
    expect(range[Op.gte].val).toBe("('2026-09-06'::date AT TIME ZONE 'America/Sao_Paulo')");
    expect(range[Op.lt].val).toBe(
      "(('2026-10-06'::date + INTERVAL '1 day') AT TIME ZONE 'America/Sao_Paulo')",
    );
  });

  it("start/end com SQL entram como string escapada, nunca como SQL", () => {
    const range = issueDate({ start: INJECTION });
    expect(range[Op.gte].val).toBe(
      `('${INJECTION.replace(/'/g, "''")}'::date AT TIME ZONE 'America/Sao_Paulo')`,
    );
  });
});
