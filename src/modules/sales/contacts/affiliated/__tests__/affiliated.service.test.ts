jest.mock("../../../../company/users/users/user.service", () => ({
  __esModule: true,
  default: {
    loginAs: jest.fn(),
    getMe: jest.fn(),
  },
}));

import userService from "../../../../company/users/users/user.service";
import { AffiliatedService } from "../affiliated.service";

const affiliatedUser = {
  id: "user-uuid",
  name: "Afiliado Teste",
  email: "afiliado@email.com",
  password: "hash",
  type: "affiliated",
  role_id: "role-uuid",
  unitBusiness: { id: "ub21", number: "21", name: "CD 21", cnpj: "000" },
};

describe("AffiliatedService", () => {
  const service = new AffiliatedService();

  beforeEach(() => jest.clearAllMocks());

  it("login usa loginAs com o tipo afiliado e devolve só o perfil enxuto", async () => {
    (userService.loginAs as jest.Mock).mockResolvedValue({ token: "tok", user: affiliatedUser });

    const result = await service.login("afiliado@email.com", "senha");

    expect(userService.loginAs).toHaveBeenCalledWith("afiliado@email.com", "senha", "affiliated");
    expect(result).toEqual({
      token: "tok",
      profile: { name: "Afiliado Teste", unit_business: { number: "21", name: "CD 21" } },
    });
  });

  it("getMe devolve o payload enxuto para afiliado", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(affiliatedUser);

    await expect(service.getMe("tok")).resolves.toEqual({
      name: "Afiliado Teste",
      unit_business: { number: "21", name: "CD 21" },
    });
  });

  it("getMe recusa quem não é afiliado", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue({ ...affiliatedUser, type: "seller" });

    await expect(service.getMe("tok")).rejects.toThrow("Usuário sem acesso a este login");
  });
});
