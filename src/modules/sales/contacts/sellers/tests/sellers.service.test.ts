
import { Op } from "sequelize";
import { SellerService } from "../services/sellers.service";

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

jest.mock("../../../../../config/sequelize", () => ({
  __esModule: true,
  default: {
    transaction: jest.fn((cb) => cb(mockTransaction)),
    where: jest.fn((col, val) => ({ col, val })),
    fn: jest.fn((fnName, ...args) => ({ fnName, args })),
    col: jest.fn((name) => name),
  },
}));

jest.mock("../../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    findAll: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock("../../../../company/unit-business-groups/unit-business-group/unit-business-group.service", () => ({
  __esModule: true,
  default: {
    findAll: jest.fn().mockResolvedValue([]),
  },
}));

jest.mock("../../../../company/users/users/user.service", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    createUserWithValidation: jest.fn(),
    updateUserWithValidation: jest.fn(),
    login: jest.fn(),
  },
}));

jest.mock("../../../../company/users/roles/role.service", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}));

// Sem mock, a cadeia real de imports abre conexão Redis/BullMQ: trava o Jest local e dá exit 1 no build Docker.
jest.mock("../../../../integrations/integration-mapping/integration-mapping.service", () => ({
  __esModule: true,
  default: {
    findEntityByMapping: jest.fn(),
    createOrUpdateIntegrationMapping: jest.fn(),
  },
}));

jest.mock("../repositories/sellers.repository", () => ({
  __esModule: true,
  default: {
    findByNormalizedName: jest.fn(),
    update: jest.fn(),
  },
}));

import sequelize from "../../../../../config/sequelize";
import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import userService from "../../../../company/users/users/user.service";
import roleService from "../../../../company/users/roles/role.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockTransaction = { LOCK: { UPDATE: "UPDATE" } } as any;

const mockRole = { id: "role-uuid", name: "Vendedor" };
const mockSeller = {
  id: "contact-uuid",
  name: "Calebe Munhoz Venancio",
  id_system: "15596863665",
  unit_business_id: "ub-uuid",
  type: "SELLER",
};
const mockUnitBusiness = { id: "ub-uuid", number: "01", name: "Loja 01" };
const mockUser = { id: "user-uuid", name: "Calebe Munhoz Venancio" };
const mockToken = "jwt.token.here";
const mockUrl = `https://hub.paxpneus.com.br/reports/sales/seller/${mockToken}`;

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("SellerService.createUserFromSellerName", () => {
  let service: SellerService;
  const originalFrontendUrl = process.env.FRONTEND_URL;

  // URL esperada é a default do service — sem isso o FRONTEND_URL do .env local quebra o teste.
  beforeAll(() => {
    delete process.env.FRONTEND_URL;
  });

  // process.env converte undefined em "undefined" — só restaura se existia.
  afterAll(() => {
    if (originalFrontendUrl !== undefined) process.env.FRONTEND_URL = originalFrontendUrl;
  });

  beforeEach(() => {
    service = new SellerService();

    // Repositório interno do service
    (service as any).repository = {
      findByNormalizedName: jest.fn().mockResolvedValue(mockSeller),
      update: jest.fn().mockResolvedValue(undefined),
    };

    // Dependências externas — caminho feliz por padrão
    (roleService.findOne as jest.Mock).mockResolvedValue(mockRole);
    (unitBusinessService.findOne as jest.Mock).mockResolvedValue(mockUnitBusiness);
    (userService.findOne as jest.Mock).mockResolvedValue(null); // user não existe ainda
    (userService.createUserWithValidation as jest.Mock).mockResolvedValue(mockUser);
    (userService.login as jest.Mock).mockResolvedValue({ token: mockToken, user: mockUser });
  });

  // ── Normalização ────────────────────────────────────────────────────────────

  describe("normalização de inputs", () => {
    it("normaliza o número da loja com padding de zero", async () => {
      await service.createUserFromSellerName("Calebe Munhoz Venancio", 1, "calebe@email.com", "senha123");

      expect(unitBusinessService.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { number: "01" } })
      );
    });

    it("aceita número da loja já formatado como string '01'", async () => {
      await service.createUserFromSellerName("Calebe Munhoz Venancio", "01", "calebe@email.com", "senha123");

      expect(unitBusinessService.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ where: { number: "01" } })
      );
    });

    it("normaliza o nome do seller para lowercase e trim antes de buscar", async () => {
      await service.createUserFromSellerName("  CALEBE MUNHOZ VENANCIO  ", 1, "calebe@email.com", "senha123");

      // O sequelize.fn('LOWER', ...) é chamado com o nome já trimado/lower do lado JS
      // e o banco recebe a versão normalizada para comparação
      expect((service as any).repository.findByNormalizedName).toHaveBeenCalled();
    });
  });

  // ── Erros de validação ───────────────────────────────────────────────────────

  describe("erros esperados", () => {
    it("lança erro se role 'Vendedor' não existe", async () => {
      (roleService.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createUserFromSellerName("Calebe", 1, "calebe@email.com", "senha123")
      ).rejects.toThrow('Role "Vendedor" não encontrada');
    });

    it("lança erro se o seller não é encontrado pelo nome", async () => {
      (service as any).repository.findByNormalizedName.mockResolvedValue(null);

      await expect(
        service.createUserFromSellerName("Nome Inexistente", 1, "calebe@email.com", "senha123")
      ).rejects.toThrow("Vendedor");
    });

    it("lança erro se a loja não é encontrada pelo número", async () => {
      (unitBusinessService.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createUserFromSellerName("Calebe Munhoz Venancio", 99, "calebe@email.com", "senha123")
      ).rejects.toThrow('Loja número "99" não encontrada');
    });
  });

  // ── Atualização do contact ───────────────────────────────────────────────────

  describe("sincronização do unit_business_id no contact", () => {
    it("atualiza o contact quando unit_business_id está vazio", async () => {
      (service as any).repository.findByNormalizedName.mockResolvedValue({
        ...mockSeller,
        unit_business_id: null,
      });

      await service.createUserFromSellerName("Calebe Munhoz Venancio", 1, "calebe@email.com", "senha123");

      expect((service as any).repository.update).toHaveBeenCalledWith(
        mockSeller.id,
        { unit_business_id: mockUnitBusiness.id },
        { transaction: mockTransaction }
      );
    });

    it("atualiza o contact quando unit_business_id é diferente da loja recebida", async () => {
      (service as any).repository.findByNormalizedName.mockResolvedValue({
        ...mockSeller,
        unit_business_id: "outro-ub-uuid",
      });

      await service.createUserFromSellerName("Calebe Munhoz Venancio", 1, "calebe@email.com", "senha123");

      expect((service as any).repository.update).toHaveBeenCalledWith(
        mockSeller.id,
        { unit_business_id: mockUnitBusiness.id },
        { transaction: mockTransaction }
      );
    });

    it("NÃO atualiza o contact quando unit_business_id já está correto", async () => {
      // mockSeller.unit_business_id === mockUnitBusiness.id
      await service.createUserFromSellerName("Calebe Munhoz Venancio", 1, "calebe@email.com", "senha123");

      expect((service as any).repository.update).not.toHaveBeenCalled();
    });
  });

  // ── resolveUser ─────────────────────────────────────────────────────────────

  describe("resolveUser", () => {
    it("cria o usuário e retorna token quando não existe", async () => {
      (userService.findOne as jest.Mock).mockResolvedValue(null);

      const result = await service.createUserFromSellerName(
        "Calebe Munhoz Venancio", 1, "calebe@email.com", "senha123"
      );

      expect(userService.createUserWithValidation).toHaveBeenCalledWith(
        expect.objectContaining({
          name: mockSeller.name,
          email: "calebe@email.com",
          cpf: mockSeller.id_system,
          unit_business_id: mockUnitBusiness.id,
          role_id: mockRole.id,
        })
      );
      expect(userService.login).toHaveBeenCalledWith("calebe@email.com", "senha123");
      expect(result).toEqual({ url: mockUrl, user: mockUser });
    });

    it("apenas faz login quando usuário com o email já existe", async () => {
      (userService.findOne as jest.Mock).mockResolvedValue(mockUser);

      const result = await service.createUserFromSellerName(
        "Calebe Munhoz Venancio", 1, "calebe@email.com", "senha123"
      );

      expect(userService.createUserWithValidation).not.toHaveBeenCalled();
      expect(userService.login).toHaveBeenCalledWith("calebe@email.com", "senha123");
      expect(result).toEqual({ url: mockUrl, user: mockUser });
    });
  });

  // ── Caminho feliz completo ───────────────────────────────────────────────────

  it("executa dentro de uma transaction", async () => {
    await service.createUserFromSellerName("Calebe Munhoz Venancio", 1, "calebe@email.com", "senha123");

    expect(sequelize.transaction).toHaveBeenCalledTimes(1);
  });

  it("retorna a url do front e o user no caminho feliz", async () => {
    const result = await service.createUserFromSellerName(
      "Calebe Munhoz Venancio", 1, "calebe@email.com", "senha123"
    );

    expect(result).toEqual({ url: mockUrl, user: mockUser });
  });
});

describe("SellerService.updateManagerPeriods", () => {
  const unitBusinessService = jest.requireMock("../../../../company/unit-business/unit-business.service").default;
  const unitBusinessGroupService = jest.requireMock(
    "../../../../company/unit-business-groups/unit-business-group/unit-business-group.service",
  ).default;
  // Toda loja/grupo pedido existe (devolve os ids do where), salvo quando o teste troca.
  const existingIds = ({ where }: any) => Promise.resolve(where.id[Op.in].map((id: string) => ({ id })));
  let service: SellerService;
  const store10 = { unit_business_id: "loja-10", unit_business_group_id: null };
  const store15 = { unit_business_id: "loja-15", unit_business_group_id: null };

  beforeEach(() => {
    service = new SellerService();
    (service as any).repository = {
      findById: jest.fn().mockResolvedValue({ id: "c1", type: "SELLER_MANAGER", custom_data: { other: 1 } }),
      // Volta o que foi gravado, como o model atualizado (withManagerPeriodNames lê via toJSON).
      update: jest.fn((id, data) => Promise.resolve({ toJSON: () => ({ id, ...data }) })),
    };
    unitBusinessService.findAll.mockImplementation(existingIds);
    unitBusinessGroupService.findAll.mockImplementation(existingIds);
  });

  it("recusa loja ou grupo que não existe (período que nunca pagaria)", async () => {
    unitBusinessService.findAll.mockResolvedValue([]);
    await expect(
      service.updateManagerPeriods("c1", [{ ...store10, start_date: "2026-07-01", end_date: null }]),
    ).rejects.toThrow("não existe");
    expect((service as any).repository.update).not.toHaveBeenCalled();
  });

  it("lê o contato travado na transação", async () => {
    await service.updateManagerPeriods("c1", []);
    expect((service as any).repository.findById).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ transaction: mockTransaction, lock: "UPDATE" }),
    );
  });

  it("troca de loja: grava os dois períodos ordenados por início, mantendo as outras chaves", async () => {
    const before = { ...store10, start_date: "2023-01-01", end_date: "2026-06-30" };
    const after = { ...store15, start_date: "2026-07-01", end_date: null };
    await service.updateManagerPeriods("c1", [after, before]);
    expect((service as any).repository.update).toHaveBeenCalledWith(
      "c1",
      { custom_data: { other: 1, manager_periods: [before, after] } },
      { transaction: mockTransaction },
    );
  });

  it("contato inexistente volta null (404 no controller)", async () => {
    (service as any).repository.findById.mockResolvedValue(null);
    await expect(service.updateManagerPeriods("c1", [])).resolves.toBeNull();
    expect((service as any).repository.update).not.toHaveBeenCalled();
  });

  it("recusa contato que não é gerente", async () => {
    (service as any).repository.findById.mockResolvedValue({ id: "c1", type: "SELLER", custom_data: null });
    await expect(service.updateManagerPeriods("c1", [])).rejects.toThrow("O contato não é gerente");
  });

  it("recusa fim antes do início", async () => {
    await expect(
      service.updateManagerPeriods("c1", [{ ...store10, start_date: "2026-07-01", end_date: "2026-06-30" }]),
    ).rejects.toThrow("anterior à data de início");
    expect((service as any).repository.update).not.toHaveBeenCalled();
  });

  it("recusa período sem loja e sem grupo", async () => {
    await expect(
      service.updateManagerPeriods("c1", [
        { unit_business_id: null, unit_business_group_id: null, start_date: "2026-07-01", end_date: null },
      ]),
    ).rejects.toThrow("precisa de uma loja ou de um grupo");
  });

  it("recusa períodos sobrepostos (inclusive fim no mesmo dia do próximo início e período aberto antes de outro)", async () => {
    await expect(
      service.updateManagerPeriods("c1", [
        { ...store10, start_date: "2023-01-01", end_date: "2026-07-01" },
        { ...store15, start_date: "2026-07-01", end_date: null },
      ]),
    ).rejects.toThrow("não podem se sobrepor");
    await expect(
      service.updateManagerPeriods("c1", [
        { ...store10, start_date: "2023-01-01", end_date: null },
        { ...store15, start_date: "2026-07-01", end_date: null },
      ]),
    ).rejects.toThrow("não podem se sobrepor");
    expect((service as any).repository.update).not.toHaveBeenCalled();
  });

  it("lista vazia apaga os períodos (gerente deixa de ganhar em todo o histórico)", async () => {
    await service.updateManagerPeriods("c1", []);
    expect((service as any).repository.update).toHaveBeenCalledWith(
      "c1",
      { custom_data: { other: 1, manager_periods: [] } },
      { transaction: mockTransaction },
    );
  });
});

describe("SellerService.findDetail", () => {
  const unitBusinessService = jest.requireMock("../../../../company/unit-business/unit-business.service").default;
  const unitBusinessGroupService = jest.requireMock(
    "../../../../company/unit-business-groups/unit-business-group/unit-business-group.service",
  ).default;
  let service: SellerService;

  beforeEach(() => {
    service = new SellerService();
    (service as any).repository = { findByIdWithUser: jest.fn() };
  });

  it("põe { name } da loja e do grupo em cada período (null sem id), uma busca por tabela", async () => {
    (service as any).repository.findByIdWithUser.mockResolvedValue({
      toJSON: () => ({
        id: "c1",
        custom_data: {
          manager_periods: [
            { unit_business_id: "s10", unit_business_group_id: null, start_date: "2023-01-01", end_date: "2026-06-30" },
            { unit_business_id: "s15", unit_business_group_id: "g1", start_date: "2026-07-01", end_date: null },
          ],
        },
      }),
    });
    unitBusinessService.findAll.mockResolvedValue([
      { id: "s10", name: "Loja 10" },
      { id: "s15", name: "Loja 15" },
    ]);
    unitBusinessGroupService.findAll.mockResolvedValue([{ id: "g1", name: "Paraná" }]);

    const result: any = await service.findDetail("c1");

    expect(result.custom_data.manager_periods).toEqual([
      expect.objectContaining({ unit_business: { name: "Loja 10" }, unit_business_group: null }),
      expect.objectContaining({ unit_business: { name: "Loja 15" }, unit_business_group: { name: "Paraná" } }),
    ]);
    expect(unitBusinessService.findAll).toHaveBeenCalledTimes(1);
    expect(unitBusinessGroupService.findAll).toHaveBeenCalledTimes(1);
  });

  it("contato sem períodos volta como está, sem buscar loja/grupo", async () => {
    unitBusinessService.findAll.mockClear();
    (service as any).repository.findByIdWithUser.mockResolvedValue({ toJSON: () => ({ id: "c1", custom_data: null }) });
    await expect(service.findDetail("c1")).resolves.toEqual({ id: "c1", custom_data: null, user: null });
    expect(unitBusinessService.findAll).not.toHaveBeenCalled();
  });

  it("traz o usuário só com id/email/phone e status Ativo/Inativo (de users.active)", async () => {
    const user = { id: "u1", email: "a@b.com", phone: null, active: false };
    (service as any).repository.findByIdWithUser.mockResolvedValue({
      user,
      toJSON: () => ({ id: "c1", custom_data: null, user }),
    });
    await expect(service.findDetail("c1")).resolves.toEqual({
      id: "c1",
      custom_data: null,
      user: { id: "u1", email: "a@b.com", phone: null, status: "Inativo" },
    });
  });

  it("contato inexistente volta null (404 no controller)", async () => {
    (service as any).repository.findByIdWithUser.mockResolvedValue(null);
    await expect(service.findDetail("c1")).resolves.toBeNull();
  });
});

// ─── createWithUser ───────────────────────────────────────────────────────────

describe("SellerService.createWithUser", () => {
  let service: SellerService;
  const baseDto = {
    name: "Afiliado Teste",
    cpf: "12345678909",
    email: "afiliado@email.com",
    password: "senha12345",
    phone: "11999999999",
  };
  const createdUser = {
    id: "user-uuid",
    name: baseDto.name,
    email: baseDto.email,
    cpf: baseDto.cpf,
    phone: baseDto.phone,
    unit_business_id: "ub21-uuid",
    password: "hash",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SellerService();
    (service as any).repository = {
      create: jest.fn().mockImplementation(async (data) => ({ id: "contact-uuid", ...data })),
    };
    (roleService.findOne as jest.Mock).mockImplementation(async ({ where }) => ({ id: `role-${where.name}` }));
    (unitBusinessService.findOne as jest.Mock).mockResolvedValue({ id: "ub21-uuid" });
    (userService.createUserWithValidation as jest.Mock).mockResolvedValue(createdUser);
  });

  it("AFFILIATED: fixa a loja 21, usa a role Afiliado e cria contact sem id_system", async () => {
    const result = await service.createWithUser({ ...baseDto, type: "AFFILIATED", unit_business_id: "ignored-uuid" });

    expect(roleService.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "Afiliado" }, attributes: ["id"] }),
    );
    expect(unitBusinessService.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { number: "21" }, attributes: ["id"] }),
    );
    expect(userService.createUserWithValidation).toHaveBeenCalledWith(
      expect.objectContaining({ unit_business_id: "ub21-uuid", role_id: "role-Afiliado", type: "affiliated", phone: baseDto.phone }),
      mockTransaction,
    );

    const contactData = (service as any).repository.create.mock.calls[0][0];
    expect(contactData).toEqual(
      expect.objectContaining({ type: "AFFILIATED", document: baseDto.cpf, unit_business_id: "ub21-uuid", user_id: "user-uuid" }),
    );
    expect(contactData).not.toHaveProperty("id_system");
    expect(contactData).not.toHaveProperty("custom_data");
    expect(result.user).not.toHaveProperty("password");
    expect(result.user).toEqual(expect.objectContaining({ id: "user-uuid", type: "affiliated" }));
  });

  it("SELLER: exige unit_business_id", async () => {
    await expect(service.createWithUser({ ...baseDto, type: "SELLER" })).rejects.toThrow("obrigatória");
    expect(userService.createUserWithValidation).not.toHaveBeenCalled();
  });

  it("SELLER: usa a loja informada e a role Vendedor", async () => {
    await service.createWithUser({ ...baseDto, type: "SELLER", unit_business_id: "ub-x" });

    expect(unitBusinessService.findOne).not.toHaveBeenCalled();
    expect(userService.createUserWithValidation).toHaveBeenCalledWith(
      expect.objectContaining({ unit_business_id: "ub-x", role_id: "role-Vendedor", type: "seller" }),
      mockTransaction,
    );
  });

  it("CUSTOMER e SELLER_MANAGER: tipo sem config não permite criar usuário", async () => {
    await expect(service.createWithUser({ ...baseDto, type: "CUSTOMER" })).rejects.toThrow(
      'Tipo de contato "CUSTOMER" não permite criar usuário',
    );
    await expect(service.createWithUser({ ...baseDto, type: "SELLER_MANAGER" })).rejects.toThrow(
      'Tipo de contato "SELLER_MANAGER" não permite criar usuário',
    );
  });
});

// ─── updateWithUser ───────────────────────────────────────────────────────────

describe("SellerService.updateWithUser", () => {
  let service: SellerService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new SellerService();
    (service as any).repository = {
      findById: jest.fn().mockResolvedValue({ id: "c1", user_id: "u1" }),
      update: jest.fn(),
      findByIdWithUser: jest.fn().mockResolvedValue({ toJSON: () => ({ id: "c1", custom_data: null }), user: null }),
    };
  });

  it("atualiza usuário e contato na mesma transação, com o mesmo nome; status vira active", async () => {
    await service.updateWithUser("c1", { name: "Novo Nome", password: "senha12345", status: "Inativo" });

    expect((service as any).repository.findById).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ transaction: mockTransaction, lock: "UPDATE" }),
    );
    expect(userService.updateUserWithValidation).toHaveBeenCalledWith(
      "u1",
      { name: "Novo Nome", password: "senha12345", active: false },
      mockTransaction,
    );
    expect((service as any).repository.update).toHaveBeenCalledWith("c1", { name: "Novo Nome" }, { transaction: mockTransaction });
    expect((service as any).repository.findByIdWithUser).toHaveBeenCalledWith("c1");
  });

  it("sem nome no corpo não mexe no contato; sem senha/status não manda esses campos", async () => {
    await service.updateWithUser("c1", { email: "x@y.com" });

    expect(userService.updateUserWithValidation).toHaveBeenCalledWith("u1", { email: "x@y.com" }, mockTransaction);
    expect((service as any).repository.update).not.toHaveBeenCalled();
  });

  it("contato inexistente volta null; contato sem usuário dá erro", async () => {
    (service as any).repository.findById.mockResolvedValueOnce(null);
    await expect(service.updateWithUser("c1", { name: "Abc" })).resolves.toBeNull();

    (service as any).repository.findById.mockResolvedValueOnce({ id: "c1", user_id: null });
    await expect(service.updateWithUser("c1", { name: "Abc" })).rejects.toThrow("Este contato não tem usuário para editar");
    expect(userService.updateUserWithValidation).not.toHaveBeenCalled();
  });

  it("e-mail de outro usuário: repassa o erro do user.service", async () => {
    (userService.updateUserWithValidation as jest.Mock).mockRejectedValueOnce(new Error("Outro usuário já possui este email"));
    await expect(service.updateWithUser("c1", { email: "x@y.com" })).rejects.toThrow("Outro usuário já possui este email");
    expect((service as any).repository.update).not.toHaveBeenCalled();
  });
});
