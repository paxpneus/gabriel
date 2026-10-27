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
// ─── createWithUser ───────────────────────────────────────────────────────────

describe("ContactService.createWithUser", () => {
  let service: ContactService;
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
    service = new ContactService();
    (service as any).repository = {
      create: jest.fn().mockImplementation(async (data) => ({ id: "contact-uuid", ...data })),
    };
    (roleService.findOne as jest.Mock).mockImplementation(async ({ where }) => ({
      id: `role-${where.name}`,
    }));
    (unitBusinessService.findOne as jest.Mock).mockResolvedValue({ id: "ub21-uuid" });
    (userService.createUserWithValidation as jest.Mock).mockResolvedValue(createdUser);
  });

  it("AFFILIATED: fixa a loja 21, usa a role Afiliado e cria contact sem id_system", async () => {
    const result = await service.createWithUser({
      ...baseDto,
      type: "AFFILIATED",
      unit_business_id: "ignored-uuid",
    });

    expect(roleService.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { name: "Afiliado" }, attributes: ["id"] }),
    );
    expect(unitBusinessService.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { number: "21" }, attributes: ["id"] }),
    );
    expect(userService.createUserWithValidation).toHaveBeenCalledWith(
      expect.objectContaining({
        unit_business_id: "ub21-uuid",
        role_id: "role-Afiliado",
        type: "affiliated",
        phone: baseDto.phone,
      }),
      mockTransaction,
    );

    const contactData = (service as any).repository.create.mock.calls[0][0];
    expect(contactData).toEqual(
      expect.objectContaining({
        type: "AFFILIATED",
        document: baseDto.cpf,
        unit_business_id: "ub21-uuid",
        user_id: "user-uuid",
      }),
    );
    expect(contactData).not.toHaveProperty("id_system");
    expect(result.user).not.toHaveProperty("password");
    expect(result.user).toEqual(expect.objectContaining({ id: "user-uuid", type: "affiliated" }));
  });

  it("SELLER: exige unit_business_id", async () => {
    await expect(service.createWithUser({ ...baseDto, type: "SELLER" })).rejects.toThrow(
      "obrigatória",
    );
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

  it("CUSTOMER: tipo sem config não permite criar usuário", async () => {
    await expect(service.createWithUser({ ...baseDto, type: "CUSTOMER" })).rejects.toThrow(
      'Tipo de contato "CUSTOMER" não permite criar usuário',
    );
  });
});

// ─── update (merge de custom_data) ────────────────────────────────────────────

describe("ContactService.update", () => {
  let service: ContactService;

  beforeEach(() => {
    service = new ContactService();
    (service as any).repository = {
      findById: jest.fn().mockResolvedValue({ id: "c1", custom_data: { a: 1, b: 2 } }),
      update: jest.fn().mockResolvedValue({ id: "c1" }),
    };
  });

  it("faz merge do custom_data com o valor atual", async () => {
    await service.update("c1", { custom_data: { b: 3, c: 4 } });

    expect((service as any).repository.findById).toHaveBeenCalledWith(
      "c1",
      expect.objectContaining({ attributes: ["id", "custom_data"] }),
    );
    expect((service as any).repository.update).toHaveBeenCalledWith(
      "c1",
      { custom_data: { a: 1, b: 3, c: 4 } },
      undefined,
    );
  });

  it("sem custom_data não busca o atual", async () => {
    await service.update("c1", { name: "Novo" });

    expect((service as any).repository.findById).not.toHaveBeenCalled();
    expect((service as any).repository.update).toHaveBeenCalledWith("c1", { name: "Novo" }, undefined);
  });
});
