jest.mock("../../../../company/users/users/user.service", () => ({
  __esModule: true,
  default: {
    loginAs: jest.fn(),
    getMe: jest.fn(),
  },
}));

import userService from "../../../../company/users/users/user.service";
import { AffiliatedService } from "../affiliated.service";

const fullUser = {
  id: "user-1",
  name: "Afiliado Teste",
  email: "afiliado@email.com",
  cpf: "52998224725",
  password: "hash",
  type: "affiliated",
  role: { permissions: [] },
  unitBusiness: { id: "cd21", number: "21", name: "CD 21", cnpj: "000" },
};

describe("AffiliatedService", () => {
  const service = new AffiliatedService();

  beforeEach(() => jest.clearAllMocks());

  it("login usa loginAs com o tipo affiliated e devolve só nome + loja", async () => {
    (userService.loginAs as jest.Mock).mockResolvedValue({ token: "jwt", user: fullUser });

    const result = await service.login("afiliado@email.com", "senha");

    expect(userService.loginAs).toHaveBeenCalledWith("afiliado@email.com", "senha", "affiliated");
    expect(result).toEqual({
      token: "jwt",
      profile: { name: "Afiliado Teste", unit_business: { number: "21", name: "CD 21" } },
    });
  });

  it("me devolve o mesmo payload enxuto", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(fullUser);

    await expect(service.getMe("jwt")).resolves.toEqual({
      name: "Afiliado Teste",
      unit_business: { number: "21", name: "CD 21" },
    });
  });

  it("me recusa token de usuário que não é afiliado", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue({ ...fullUser, type: "admin" });

    await expect(service.getMe("jwt")).rejects.toThrow("Usuário sem acesso a este login");
  });
});
