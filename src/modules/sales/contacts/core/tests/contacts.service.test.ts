import { ContactService } from "../services/contacts.service";

// Transação fake: roda o callback com um LOCK reconhecível pra conferir a trava de linha.
const mockTransaction = { LOCK: { UPDATE: "UPDATE" } };
jest.mock("../../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb) => cb(mockTransaction)) },
}));

// Trava do CRUD genérico: gerente (SELLER_MANAGER) precisa de loja ou grupo de lojas no cadastro.
describe("ContactService — gerente sem loja nem grupo", () => {
  let service: ContactService;
  let repository: Record<string, jest.Mock>;

  beforeEach(() => {
    service = new ContactService();
    repository = {
      create: jest.fn().mockResolvedValue({ id: "c1" }),
      bulkCreate: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ id: "c1" }),
      bulkUpdate: jest.fn().mockResolvedValue([1]),
      findById: jest.fn(),
      findAll: jest.fn(),
    };
    (service as any).repository = repository;
  });

  it("create recusa gerente sem loja e sem grupo, aceita com um dos dois", async () => {
    expect(() => service.create({ name: "A", type: "SELLER_MANAGER" })).toThrow("Gerente precisa ter uma loja ou um grupo");
    await service.create({ name: "A", type: "SELLER_MANAGER", unit_business_group_id: "g1" });
    await service.create({ name: "B", type: "SELLER" });
    expect(repository.create).toHaveBeenCalledTimes(2);
  });

  it("bulkCreate recusa se algum gerente vier sem loja e sem grupo", () => {
    expect(() =>
      service.bulkCreate([
        { name: "A", type: "SELLER_MANAGER", unit_business_id: "s1" } as any,
        { name: "B", type: "SELLER_MANAGER" } as any,
      ]),
    ).toThrow("Gerente precisa ter uma loja ou um grupo");
    expect(repository.bulkCreate).not.toHaveBeenCalled();
  });

  it("update junta com o cadastro atual: marcar como gerente quem não tem loja nem grupo é recusado", async () => {
    repository.findById.mockResolvedValue({ get: () => ({ type: "SELLER", unit_business_id: null, unit_business_group_id: null }) });
    await expect(service.update("c1", { type: "SELLER_MANAGER" })).rejects.toThrow("Gerente precisa ter uma loja ou um grupo");
    expect(repository.update).not.toHaveBeenCalled();
  });

  it("update de gerente: tirar a loja só passa se ficar com grupo", async () => {
    repository.findById.mockResolvedValue({
      get: () => ({ type: "SELLER_MANAGER", unit_business_id: "s1", unit_business_group_id: null }),
    });
    await expect(service.update("c1", { unit_business_id: null })).rejects.toThrow("Gerente precisa ter uma loja ou um grupo");
    await service.update("c1", { unit_business_id: null, unit_business_group_id: "g1" });
    expect(repository.update).toHaveBeenCalledTimes(1);
  });

  it("update que não mexe em tipo/loja/grupo não consulta o cadastro", async () => {
    await service.update("c1", { name: "Novo nome" });
    expect(repository.findById).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith("c1", { name: "Novo nome" }, undefined);
    expect(jest.requireMock("../../../../../config/sequelize").default.transaction).not.toHaveBeenCalled();
  });

  it("bulkUpdate checa os contatos do where, travados", async () => {
    repository.findAll.mockResolvedValue([
      { id: "c1", get: () => ({ type: "SELLER_MANAGER", unit_business_id: "s1", unit_business_group_id: null }) },
    ]);
    await expect(service.bulkUpdate({ unit_business_id: null }, { where: { id: ["c1"] } })).rejects.toThrow(
      "Gerente precisa ter uma loja ou um grupo",
    );
    expect(repository.findAll).toHaveBeenCalledWith({
      where: { id: ["c1"] },
      attributes: ["id", "type", "unit_business_id", "unit_business_group_id", "custom_data"],
      transaction: mockTransaction,
      lock: "UPDATE",
    });
    expect(repository.update).not.toHaveBeenCalled();
  });
});

// Período do gerente segue a loja/grupo do cadastro (hoje = 2026-11-05 em SP).
describe("ContactService — período automático do gerente", () => {
  let service: ContactService;
  let repository: Record<string, jest.Mock>;
  const since2023 = { unit_business_id: "loja-5", unit_business_group_id: null, start_date: "2023-01-01", end_date: null };

  // Cadastro atual do contato devolvido pelo findById do update.
  const currentContact = (attrs: Record<string, unknown>) =>
    repository.findById.mockResolvedValue({ get: () => ({ unit_business_group_id: null, ...attrs }) });

  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2026-11-05T15:00:00-03:00"));
  });
  afterAll(() => jest.useRealTimers());

  beforeEach(() => {
    service = new ContactService();
    repository = {
      create: jest.fn((data) => Promise.resolve(data)),
      update: jest.fn().mockResolvedValue({ id: "c1" }),
      findById: jest.fn(),
    };
    (service as any).repository = repository;
  });

  it("troca de loja fecha o período aberto ontem e abre o da loja nova hoje", async () => {
    currentContact({ type: "SELLER_MANAGER", unit_business_id: "loja-5", custom_data: { manager_periods: [since2023] } });
    await service.update("c1", { unit_business_id: "loja-8" });
    expect(repository.update).toHaveBeenCalledWith(
      "c1",
      {
        unit_business_id: "loja-8",
        custom_data: {
          manager_periods: [
            { ...since2023, end_date: "2026-11-04" },
            { unit_business_id: "loja-8", unit_business_group_id: null, start_date: "2026-11-05", end_date: null },
          ],
        },
      },
      { transaction: mockTransaction },
    );
    expect(repository.findById).toHaveBeenCalledWith("c1", expect.objectContaining({ lock: "UPDATE" }));
  });

  it("segunda troca no mesmo dia só troca a loja do período que começou hoje", async () => {
    currentContact({
      type: "SELLER_MANAGER",
      unit_business_id: "loja-8",
      custom_data: {
        manager_periods: [
          { ...since2023, end_date: "2026-11-04" },
          { unit_business_id: "loja-8", unit_business_group_id: null, start_date: "2026-11-05", end_date: null },
        ],
      },
    });
    await service.update("c1", { unit_business_id: "loja-10" });
    expect(repository.update.mock.calls[0][1].custom_data.manager_periods).toEqual([
      { ...since2023, end_date: "2026-11-04" },
      { unit_business_id: "loja-10", unit_business_group_id: null, start_date: "2026-11-05", end_date: null },
    ]);
  });

  it("troca de grupo também rola o período, mantendo a loja", async () => {
    currentContact({ type: "SELLER_MANAGER", unit_business_id: "loja-5", custom_data: { manager_periods: [since2023] } });
    await service.update("c1", { unit_business_group_id: "g1" });
    expect(repository.update.mock.calls[0][1].custom_data.manager_periods[1]).toEqual({
      unit_business_id: "loja-5",
      unit_business_group_id: "g1",
      start_date: "2026-11-05",
      end_date: null,
    });
  });

  it("vendedor que vira gerente ganha período aberto de hoje", async () => {
    currentContact({ type: "SELLER", unit_business_id: "loja-5", custom_data: null });
    await service.update("c1", { type: "SELLER_MANAGER" });
    expect(repository.update.mock.calls[0][1].custom_data).toEqual({
      manager_periods: [{ unit_business_id: "loja-5", unit_business_group_id: null, start_date: "2026-11-05", end_date: null }],
    });
  });

  it("body com a mesma loja (tela manda o cadastro inteiro) não mexe nos períodos", async () => {
    currentContact({ type: "SELLER_MANAGER", unit_business_id: "loja-5", custom_data: { manager_periods: [since2023] } });
    await service.update("c1", { type: "SELLER_MANAGER", unit_business_id: "loja-5", name: "X" });
    expect(repository.update.mock.calls[0][1]).not.toHaveProperty("custom_data");
  });

  it("gerente desligado que troca de loja pela tela volta a ser gerente a partir de hoje", async () => {
    const closed = { ...since2023, end_date: "2026-06-30" };
    currentContact({ type: "SELLER_MANAGER", unit_business_id: "loja-5", custom_data: { manager_periods: [closed] } });
    await service.update("c1", { unit_business_id: "loja-8" });
    expect(repository.update.mock.calls[0][1].custom_data.manager_periods).toEqual([
      closed,
      { unit_business_id: "loja-8", unit_business_group_id: null, start_date: "2026-11-05", end_date: null },
    ]);
  });

  it("voltar hoje pro grupo que terminou ontem reabre o mesmo período (caso Jhonny: Paraná até 04/11 → Paraná)", async () => {
    const parana = { unit_business_id: null, unit_business_group_id: "parana", start_date: "2023-01-01", end_date: "2026-11-04" };
    currentContact({
      type: "SELLER_MANAGER",
      unit_business_id: null,
      unit_business_group_id: "regional-1",
      custom_data: { manager_periods: [parana] },
    });
    await service.update("c1", { unit_business_group_id: "parana" });
    expect(repository.update.mock.calls[0][1].custom_data.manager_periods).toEqual([{ ...parana, end_date: null }]);
  });

  it("ida e volta no mesmo dia (Paraná → Regional 1 → Paraná) junta de novo num período só", async () => {
    currentContact({
      type: "SELLER_MANAGER",
      unit_business_id: null,
      unit_business_group_id: "regional-1",
      custom_data: {
        manager_periods: [
          { unit_business_id: null, unit_business_group_id: "parana", start_date: "2023-01-01", end_date: "2026-11-04" },
          { unit_business_id: null, unit_business_group_id: "regional-1", start_date: "2026-11-05", end_date: null },
        ],
      },
    });
    await service.update("c1", { unit_business_group_id: "parana" });
    expect(repository.update.mock.calls[0][1].custom_data.manager_periods).toEqual([
      { unit_business_id: null, unit_business_group_id: "parana", start_date: "2023-01-01", end_date: null },
    ]);
  });

  it("voltou de SELLER pra gerente com período aberto antigo: rola pra loja atual do cadastro", async () => {
    // Era gerente da 5, virou SELLER, o Bling trocou a loja pra 8 (sem rolar, era SELLER) e voltou a ser gerente.
    currentContact({ type: "SELLER", unit_business_id: "loja-8", custom_data: { manager_periods: [since2023] } });
    await service.update("c1", { type: "SELLER_MANAGER" });
    expect(repository.update.mock.calls[0][1].custom_data.manager_periods).toEqual([
      { ...since2023, end_date: "2026-11-04" },
      { unit_business_id: "loja-8", unit_business_group_id: null, start_date: "2026-11-05", end_date: null },
    ]);
  });

  it("bulkUpdate troca de loja rola o período de cada gerente (e ignora o ids do body)", async () => {
    repository.findAll = jest.fn().mockResolvedValue([
      { id: "c1", get: () => ({ type: "SELLER_MANAGER", unit_business_id: "loja-5", unit_business_group_id: null, custom_data: { manager_periods: [since2023] } }) },
      { id: "c2", get: () => ({ type: "SELLER", unit_business_id: "loja-5", unit_business_group_id: null, custom_data: null }) },
    ]);
    const result = await service.bulkUpdate({ unit_business_id: "loja-8", ids: ["c1", "c2"] } as any, { where: { id: ["c1", "c2"] } });
    expect(result).toEqual([2]);
    expect(repository.update).toHaveBeenCalledWith(
      "c1",
      {
        unit_business_id: "loja-8",
        custom_data: {
          manager_periods: [
            { ...since2023, end_date: "2026-11-04" },
            { unit_business_id: "loja-8", unit_business_group_id: null, start_date: "2026-11-05", end_date: null },
          ],
        },
      },
      { transaction: mockTransaction },
    );
    expect(repository.update).toHaveBeenCalledWith("c2", { unit_business_id: "loja-8" }, { transaction: mockTransaction });
  });

  it("contato criado já gerente nasce com período aberto de hoje", async () => {
    await service.create({ name: "A", type: "SELLER_MANAGER", unit_business_id: "loja-5" });
    expect(repository.create.mock.calls[0][0].custom_data).toEqual({
      manager_periods: [{ unit_business_id: "loja-5", unit_business_group_id: null, start_date: "2026-11-05", end_date: null }],
    });
  });
});

// Sync do vendedor do Bling: sem trava de loja/grupo, mas rola o período do gerente (hoje = 2026-11-05 em SP).
describe("ContactService.updateFromIntegration", () => {
  let service: ContactService;
  let repository: Record<string, jest.Mock>;
  const since2023 = { unit_business_id: "loja-5", unit_business_group_id: null, start_date: "2023-01-01", end_date: null };

  // Contato como o upsert do Bling acha; o service relê travado, então o findById devolve o mesmo.
  const contact = (attrs: Record<string, unknown>) => {
    const row = { id: "c1", get: () => ({ id: "c1", unit_business_group_id: null, ...attrs }) } as any;
    repository.findById.mockResolvedValue(row);
    return row;
  };

  beforeAll(() => {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
    jest.setSystemTime(new Date("2026-11-05T15:00:00-03:00"));
  });
  afterAll(() => jest.useRealTimers());

  beforeEach(() => {
    service = new ContactService();
    repository = { update: jest.fn().mockResolvedValue({ id: "c1" }), findById: jest.fn() };
    (service as any).repository = repository;
  });

  it("Bling troca a loja do gerente: fecha a antiga ontem e abre a nova hoje", async () => {
    const manager = contact({ type: "SELLER_MANAGER", unit_business_id: "loja-5", custom_data: { manager_periods: [since2023] } });
    await service.updateFromIntegration(manager, { name: "X", unit_business_id: "loja-8" });
    expect(repository.update).toHaveBeenCalledWith(
      "c1",
      {
        name: "X",
        unit_business_id: "loja-8",
        custom_data: {
          manager_periods: [
            { ...since2023, end_date: "2026-11-04" },
            { unit_business_id: "loja-8", unit_business_group_id: null, start_date: "2026-11-05", end_date: null },
          ],
        },
      },
      { transaction: mockTransaction },
    );
    expect(repository.findById).toHaveBeenCalledWith("c1", expect.objectContaining({ lock: "UPDATE" }));
  });

  it("Bling manda sem loja e o gerente não tem grupo: fica sem loja, só fecha o período, sem erro", async () => {
    const manager = contact({ type: "SELLER_MANAGER", unit_business_id: "loja-5", custom_data: { manager_periods: [since2023] } });
    await service.updateFromIntegration(manager, { unit_business_id: null });
    expect(repository.update).toHaveBeenCalledWith(
      "c1",
      { unit_business_id: null, custom_data: { manager_periods: [{ ...since2023, end_date: "2026-11-04" }] } },
      { transaction: mockTransaction },
    );
  });

  it("Bling manda sem loja e o gerente tem grupo: segue regional, período novo só com o grupo", async () => {
    const manager = contact({
      type: "SELLER_MANAGER",
      unit_business_id: "loja-5",
      unit_business_group_id: "g1",
      custom_data: { manager_periods: [{ ...since2023, unit_business_group_id: "g1" }] },
    });
    await service.updateFromIntegration(manager, { unit_business_id: null });
    expect(repository.update.mock.calls[0][1].custom_data.manager_periods[1]).toEqual({
      unit_business_id: null,
      unit_business_group_id: "g1",
      start_date: "2026-11-05",
      end_date: null,
    });
  });

  it("período aberto que começou hoje e Bling tira a loja: o período some (fecharia antes de começar)", async () => {
    const closed = { ...since2023, end_date: "2026-11-04" };
    const manager = contact({
      type: "SELLER_MANAGER",
      unit_business_id: "loja-8",
      custom_data: {
        manager_periods: [closed, { unit_business_id: "loja-8", unit_business_group_id: null, start_date: "2026-11-05", end_date: null }],
      },
    });
    await service.updateFromIntegration(manager, { unit_business_id: null });
    expect(repository.update.mock.calls[0][1].custom_data.manager_periods).toEqual([closed]);
  });

  it("Bling não reativa gerente desligado: troca de loja só atualiza o cadastro", async () => {
    const closed = { ...since2023, end_date: "2026-06-30" };
    await service.updateFromIntegration(
      contact({ type: "SELLER_MANAGER", unit_business_id: "loja-5", custom_data: { manager_periods: [closed] } }),
      { unit_business_id: "loja-8" },
    );
    expect(repository.update).toHaveBeenCalledWith("c1", { unit_business_id: "loja-8" }, { transaction: mockTransaction });
  });

  it("vendedor comum ou mesma loja: grava só os campos, sem mexer em período", async () => {
    await service.updateFromIntegration(contact({ type: "SELLER", unit_business_id: "loja-5", custom_data: null }), {
      unit_business_id: "loja-8",
    });
    await service.updateFromIntegration(
      contact({ type: "SELLER_MANAGER", unit_business_id: "loja-5", custom_data: { manager_periods: [since2023] } }),
      { name: "Y", unit_business_id: "loja-5" },
    );
    expect(repository.update.mock.calls[0]).toEqual(["c1", { unit_business_id: "loja-8" }, { transaction: mockTransaction }]);
    expect(repository.update.mock.calls[1]).toEqual([
      "c1",
      { name: "Y", unit_business_id: "loja-5" },
      { transaction: mockTransaction },
    ]);
  });
});

// Exclusão: contato com período de gerente ou com pedido/nota (FK RESTRICT) não pode ser apagado.
describe("ContactService — exclusão de contato em uso", () => {
  const { ForeignKeyConstraintError } = jest.requireActual("sequelize");
  const { ContactInUseError } = jest.requireActual("../helpers/errors");
  let service: ContactService;
  let repository: Record<string, jest.Mock>;

  beforeEach(() => {
    service = new ContactService();
    repository = { findById: jest.fn(), findAll: jest.fn(), delete: jest.fn().mockResolvedValue(true), bulkDelete: jest.fn() };
    (service as any).repository = repository;
  });

  it("recusa contato com período de gerente, sem tentar apagar", async () => {
    repository.findById.mockResolvedValue({ id: "c1", custom_data: { manager_periods: [{ start_date: "2023-01-01" }] } });
    await expect(service.delete("c1")).rejects.toBeInstanceOf(ContactInUseError);
    expect(repository.delete).not.toHaveBeenCalled();
  });

  it("FK de pedido/nota vira erro de negócio", async () => {
    repository.findById.mockResolvedValue({ id: "c1", custom_data: null });
    repository.delete.mockRejectedValue(new ForeignKeyConstraintError({}));
    await expect(service.delete("c1")).rejects.toThrow("pedidos ou notas fiscais");
  });

  it("contato sem uso é apagado; inexistente volta false", async () => {
    repository.findById.mockResolvedValueOnce({ id: "c1", custom_data: null }).mockResolvedValueOnce(null);
    await expect(service.delete("c1")).resolves.toBe(true);
    await expect(service.delete("c2")).resolves.toBe(false);
  });

  it("lote com algum contato com período é recusado inteiro", async () => {
    repository.findAll.mockResolvedValue([
      { id: "c1", custom_data: null },
      { id: "c2", custom_data: { manager_periods: [{ start_date: "2023-01-01" }] } },
    ]);
    await expect(service.bulkDelete({ where: { id: ["c1", "c2"] } })).rejects.toBeInstanceOf(ContactInUseError);
    expect(repository.bulkDelete).not.toHaveBeenCalled();
  });
});
