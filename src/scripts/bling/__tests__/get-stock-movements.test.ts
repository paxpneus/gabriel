// src/scripts/bling/__tests__/get-stock-movements.test.ts

// Mocks só pra cortar a cadeia de import pesada do script (Bling API, associações).
jest.mock("../../../modules/handlers/bling/api/bling_api.service", () => ({
  __esModule: true,
  waitForBlingRateLimit: jest.fn(),
}));

jest.mock("../../../config/sequelize-associations", () => ({
  __esModule: true,
  setupAssociations: jest.fn(),
}));

jest.mock(
  "../../../modules/inventory/stock/stock-movement-source-data/stock-movement-source-data.service",
  () => ({
    __esModule: true,
    default: { findOne: jest.fn(), upsertByFind: jest.fn() },
  }),
);

import stockMovementSourceDataService from "../../../modules/inventory/stock/stock-movement-source-data/stock-movement-source-data.service";
import { createScrapeWindow } from "../get-stock-movements";

const findOne = stockMovementSourceDataService.findOne as jest.Mock;

// Instantes em America/Sao_Paulo (UTC-3, sem horário de verão).
const brt = (iso: string) => new Date(`${iso}-03:00`);

describe("createScrapeWindow", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("tabela vazia: busca desde 01/07/2024 até agora", async () => {
    jest.useFakeTimers().setSystemTime(brt("2026-10-29T05:00:00"));
    findOne.mockResolvedValue(null);

    const window = await createScrapeWindow();

    expect(window.cutoffDate.getTime()).toBe(new Date(2024, 6, 1).getTime());
    expect(window.extractionDate).toEqual(brt("2026-10-29T05:00:00"));
    expect(window.yearStart).toEqual(brt("2026-01-01T00:00:00"));
  });

  it("meio do ano: busca desde 30/12 do ano anterior", async () => {
    jest.useFakeTimers().setSystemTime(brt("2026-10-29T05:00:00"));
    findOne.mockResolvedValue({ extraction_date: brt("2026-10-28T05:00:00") });

    const window = await createScrapeWindow();

    expect(window.cutoffDate).toEqual(brt("2025-12-30T00:00:00"));
    expect(window.yearStart).toEqual(brt("2026-01-01T00:00:00"));
  });

  it("primeira execução do ano: cobre o resto de 31/12 do ano anterior", async () => {
    jest.useFakeTimers().setSystemTime(brt("2027-01-01T05:00:00"));
    findOne.mockResolvedValue({ extraction_date: brt("2026-12-31T05:00:00") });

    const window = await createScrapeWindow();

    expect(window.cutoffDate).toEqual(brt("2026-12-30T00:00:00"));
    expect(window.cutoffDate.getTime()).toBeLessThan(
      brt("2026-12-31T15:00:00").getTime(),
    );
    expect(window.yearStart).toEqual(brt("2027-01-01T00:00:00"));
  });

  it("job parado na virada: retoma da última extração anterior a 30/12", async () => {
    jest.useFakeTimers().setSystemTime(brt("2027-01-02T05:00:00"));
    findOne.mockResolvedValue({ extraction_date: brt("2026-12-20T05:00:00") });

    const window = await createScrapeWindow();

    expect(window.cutoffDate).toEqual(brt("2026-12-20T05:00:00"));
    expect(window.yearStart).toEqual(brt("2027-01-01T00:00:00"));
  });
});
