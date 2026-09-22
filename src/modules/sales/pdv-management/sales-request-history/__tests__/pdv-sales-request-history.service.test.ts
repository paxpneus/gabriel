import { PdvSalesRequestHistoryService } from "../pdv-sales-request-history.service";

describe("PdvSalesRequestHistoryService", () => {
  const service = new PdvSalesRequestHistoryService();

  it("nunca permite excluir uma linha de histórico via service", async () => {
    await expect(service.delete("h1")).rejects.toThrow(
      /não pode ser excluído diretamente/,
    );
  });

  it("nunca permite excluir em lote via service", async () => {
    await expect(service.bulkDelete({ where: {} } as any)).rejects.toThrow(
      /não pode ser excluído diretamente/,
    );
  });
});
