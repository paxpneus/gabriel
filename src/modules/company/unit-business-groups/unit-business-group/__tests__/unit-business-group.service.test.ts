import { UnitBusinessGroupService } from "../unit-business-group.service";
import { UnitBusinessGroupInUseError } from "../unit-business-group.types";

// Fachada do core de contacts mockada: só a busca de gerentes por grupo importa aqui.
jest.mock("../../../../sales/contacts/core", () => ({
  contactService: { findManagerNamesByPeriodGroups: jest.fn() },
}));
const { contactService } = jest.requireMock("../../../../sales/contacts/core");

// Grupo usado em período de gerente não pode ser apagado (membros saem em cascata e o regional perderia o histórico).
describe("UnitBusinessGroupService — exclusão de grupo em uso", () => {
  let service: UnitBusinessGroupService;
  let repository: Record<string, jest.Mock>;

  beforeEach(() => {
    service = new UnitBusinessGroupService();
    repository = { delete: jest.fn().mockResolvedValue(true), bulkDelete: jest.fn().mockResolvedValue(1), findAll: jest.fn() };
    (service as any).repository = repository;
  });

  it("recusa grupo nos períodos de algum gerente, com o nome dele na mensagem", async () => {
    contactService.findManagerNamesByPeriodGroups.mockResolvedValue(["Jhonny"]);
    const result = service.delete("g1");
    await expect(result).rejects.toBeInstanceOf(UnitBusinessGroupInUseError);
    await expect(result).rejects.toThrow("Jhonny");
    expect(contactService.findManagerNamesByPeriodGroups).toHaveBeenCalledWith(["g1"]);
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it("grupo sem período de gerente é apagado", async () => {
    contactService.findManagerNamesByPeriodGroups.mockResolvedValue([]);
    await expect(service.delete("g1")).resolves.toBe(true);
  });

  it("lote checa todos os grupos do where numa busca só", async () => {
    repository.findAll.mockResolvedValue([{ id: "g1" }, { id: "g2" }]);
    contactService.findManagerNamesByPeriodGroups.mockResolvedValue(["Marcos"]);
    await expect(service.bulkDelete({ where: { id: ["g1", "g2"] } })).rejects.toThrow("Marcos");
    expect(contactService.findManagerNamesByPeriodGroups).toHaveBeenCalledWith(["g1", "g2"]);
    expect(repository.bulkDelete).not.toHaveBeenCalled();
  });
});
