// src/__tests__/contacts/contacts.service.test.ts

import { ContactService } from "../../contacts/contacts.service";

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

jest.mock("../../../../config/sequelize", () => ({
  __esModule: true,
  default: {
    transaction: jest.fn((cb) => cb(mockTransaction)),
    where: jest.fn((col, val) => ({ col, val })),
    fn: jest.fn((fnName, ...args) => ({ fnName, args })),
    col: jest.fn((name) => name),
  },
}));

jest.mock("../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}));

jest.mock("../../../company/users/users/user.service", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    createUserWithValidation: jest.fn(),
    login: jest.fn(),
  },
}));

jest.mock("../../../company/users/roles/role.service", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
  },
}));

jest.mock("../contacts.repository", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    update: jest.fn(),
  },
}));

import sequelize from "../../../../config/sequelize";
import unitBusinessService from "../../../company/unit-business/unit-business.service";
import userService from "../../../company/users/users/user.service";
import roleService from "../../../company/users/roles/role.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockTransaction = {} as any;

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

describe("ContactService.createUserFromSellerName", () => {
  let service: ContactService;

  beforeEach(() => {
    service = new ContactService();

    // Repositório interno do service
    (service as any).repository = {
      findOne: jest.fn().mockResolvedValue(mockSeller),
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
      expect((service as any).repository.findOne).toHaveBeenCalled();
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
      (service as any).repository.findOne.mockResolvedValue(null);

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
      (service as any).repository.findOne.mockResolvedValue({
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
      (service as any).repository.findOne.mockResolvedValue({
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

describe("ContactService.createWithUser", () => {
  let service: ContactService;
  const createdUser = {
    id: "user-uuid",
    name: "Afiliado Teste",
    email: "afiliado@email.com",
    cpf: "52998224725",
    phone: null,
    unit_business_id: "cd21-uuid",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ContactService();
    (service as any).repository = {
      create: jest.fn().mockImplementation(async (data) => ({ id: "contact-uuid", ...data })),
    };
    (roleService.findOne as jest.Mock).mockResolvedValue({ id: "role-affiliated" });
    (unitBusinessService.findOne as jest.Mock).mockResolvedValue({ id: "cd21-uuid" });
    (userService.createUserWithValidation as jest.Mock).mockResolvedValue(createdUser);
  });

  const baseDto = {
    name: "Afiliado Teste",
    cpf: "52998224725",
    email: "afiliado@email.com",
    password: "senha1234",
  };

  it("afiliado: loja 21 fixa, role Afiliado, user type affiliated, mesma transação", async () => {
    const result = await service.createWithUser({
      ...baseDto,
      type: "AFFILIATED",
      unit_business_id: "ignored-uuid",
      custom_data: { origem: "indicacao" },
    } as any);

    expect(roleService.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "Afiliado" } }),
    );
    expect(unitBusinessService.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { number: "21" } }),
    );
    expect(userService.createUserWithValidation).toHaveBeenCalledWith(
      expect.objectContaining({
        unit_business_id: "cd21-uuid",
        user_unit_business: ["cd21-uuid"],
        role_id: "role-affiliated",
        type: "affiliated",
        phone: null,
      }),
      mockTransaction,
    );
    expect((service as any).repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "AFFILIATED",
        user_id: "user-uuid",
        unit_business_id: "cd21-uuid",
        document: "52998224725",
        custom_data: { origem: "indicacao" },
      }),
      { transaction: mockTransaction },
    );
    // id_system é do sistema externo (Bling); contact criado aqui não tem.
    expect((service as any).repository.create.mock.calls[0][0]).not.toHaveProperty("id_system");
    expect(result.user).toEqual(expect.objectContaining({ id: "user-uuid", type: "affiliated" }));
    expect(result.user).not.toHaveProperty("password");
  });

  it("seller: loja vem do body", async () => {
    await service.createWithUser({ ...baseDto, type: "SELLER", unit_business_id: "loja-uuid" } as any);

    expect(unitBusinessService.findOne).not.toHaveBeenCalled();
    expect(userService.createUserWithValidation).toHaveBeenCalledWith(
      expect.objectContaining({ unit_business_id: "loja-uuid", type: "seller" }),
      mockTransaction,
    );
  });

  it("seller sem loja no body lança erro", async () => {
    await expect(
      service.createWithUser({ ...baseDto, type: "SELLER" } as any),
    ).rejects.toThrow("unit_business_id");
  });

  it("tipo sem config de usuário lança erro", async () => {
    await expect(
      service.createWithUser({ ...baseDto, type: "CUSTOMER" } as any),
    ).rejects.toThrow("não permite criar usuário");
  });
});

describe("ContactService.update (custom_data)", () => {
  let service: ContactService;
  let repository: Record<string, jest.Mock>;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ContactService();
    repository = {
      findOne: jest.fn().mockResolvedValue({
        id: "contact-uuid",
        type: "AFFILIATED",
        custom_data: { origem: "indicacao", canal: "instagram" },
      }),
      update: jest.fn().mockImplementation(async (_id, data) => data),
    };
    (service as any).repository = repository;
  });

  it("faz merge com o JSON atual em vez de substituir", async () => {
    await service.update("contact-uuid", { custom_data: { canal: "tiktok" } });

    expect(repository.update).toHaveBeenCalledWith(
      "contact-uuid",
      { custom_data: { origem: "indicacao", canal: "tiktok" } },
      undefined,
    );
  });

  it("sem custom_data → update normal, sem buscar o contato", async () => {
    await service.update("contact-uuid", { name: "Novo nome" });
    expect(repository.findOne).not.toHaveBeenCalled();
    expect(repository.update).toHaveBeenCalledWith("contact-uuid", { name: "Novo nome" }, undefined);
  });

  it("contato inexistente → null", async () => {
    repository.findOne.mockResolvedValue(null);
    await expect(service.update("x", { custom_data: { a: 1 } })).resolves.toBeNull();
    expect(repository.update).not.toHaveBeenCalled();
  });
});
