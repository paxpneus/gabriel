jest.mock("../../../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    getCd21UnitBusiness: jest.fn(),
  },
}));

jest.mock("../../../../../company/users/users/user.service", () => ({
  __esModule: true,
  default: { getMe: jest.fn() },
}));

import userService from "../../../../../company/users/users/user.service";
import { resolveLoginAccess } from "../resolve-pdv-access";
import { PdvAccessScreen } from "../../pdv-access.types";

// Regra determinística (ver resolve-pdv-access.ts): NUNCA via
// ROLE_PERMISSIONS/userHasPermission — só user_config.type + unit_business.
function makeUser(overrides: Partial<any> = {}) {
  return {
    id: "user-1",
    unit_business_id: "ub-1",
    unitBusiness: { id: "ub-1", number: "09" },
    config: { type: "operator" },
    ...overrides,
  };
}

const ALL_SCREENS = [
  PdvAccessScreen.STORE_REQUEST,
  PdvAccessScreen.FINANCE,
  PdvAccessScreen.CD21,
];

describe("resolveLoginAccess", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("sem cookie, retorna null sem consultar o usuário", async () => {
    const result = await resolveLoginAccess(undefined, ALL_SCREENS);

    expect(result).toBeNull();
    expect(userService.getMe).not.toHaveBeenCalled();
  });

  it("getMe lança (token inválido/expirado) — retorna null em vez de propagar", async () => {
    (userService.getMe as jest.Mock).mockRejectedValue(new Error("boom"));

    const result = await resolveLoginAccess("token", ALL_SCREENS);

    expect(result).toBeNull();
  });

  it("usuário de loja normal (não-CD21, não-12/17, config.type != finance) — resolve STORE_REQUEST escopado na própria loja", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(
      makeUser({ unit_business_id: "ub-loja-15", unitBusiness: { id: "ub-loja-15", number: "15" } }),
    );

    const result = await resolveLoginAccess("token", ALL_SCREENS);

    expect(result).toEqual({
      screen: PdvAccessScreen.STORE_REQUEST,
      via: "LOGIN",
      unitBusinessId: "ub-loja-15",
      userId: "user-1",
    });
  });

  it("config.type === 'finance' resolve FINANCE (global) mesmo a loja sendo uma loja física comum", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(
      makeUser({ config: { type: "finance" } }),
    );

    const result = await resolveLoginAccess("token", ALL_SCREENS);

    expect(result).toEqual({
      screen: PdvAccessScreen.FINANCE,
      via: "LOGIN",
      unitBusinessId: null,
      userId: "user-1",
    });
  });

  it("unit business é a CD21 (number 21) e tipo não é finance — resolve CD21 (global)", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(
      makeUser({ unitBusiness: { id: "ub-cd21", number: "21" } }),
    );

    const result = await resolveLoginAccess("token", ALL_SCREENS);

    expect(result).toEqual({
      screen: PdvAccessScreen.CD21,
      via: "LOGIN",
      unitBusinessId: null,
      userId: "user-1",
    });
  });

  it("config.type === 'finance' tem prioridade sobre a loja ser a CD21", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(
      makeUser({
        unitBusiness: { id: "ub-cd21", number: "21" },
        config: { type: "finance" },
      }),
    );

    const result = await resolveLoginAccess("token", ALL_SCREENS);

    expect(result?.screen).toBe(PdvAccessScreen.FINANCE);
  });

  it.each(["12", "17"])(
    "loja %s (excluída do PDV) — sem tela nenhuma, retorna null",
    async (number) => {
      (userService.getMe as jest.Mock).mockResolvedValue(
        makeUser({ unitBusiness: { id: "ub-x", number } }),
      );

      const result = await resolveLoginAccess("token", ALL_SCREENS);

      expect(result).toBeNull();
    },
  );

  it("usuário sem unit business e sem config.type finance — sem tela nenhuma, retorna null", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(
      makeUser({ unit_business_id: null, unitBusiness: null }),
    );

    const result = await resolveLoginAccess("token", ALL_SCREENS);

    expect(result).toBeNull();
  });

  it("tela resolvida não está entre as exigidas pela rota — retorna null (cai pro link)", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(makeUser());

    const result = await resolveLoginAccess("token", [PdvAccessScreen.FINANCE]);

    expect(result).toBeNull();
  });

  // Regressão do bug real: loja legítima (STORE_REQUEST) batendo numa rota
  // que também aceita FINANCE/CD21 (ex.: POST /:id/receipt) nunca deve mais
  // cair em FINANCE por resíduo de permissão de role — a tela é só função
  // de unit_business/config.type, nunca de ROLE_PERMISSIONS.
  it("loja normal batendo numa rota compartilhada com FINANCE/CD21 continua resolvendo STORE_REQUEST", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(
      makeUser({ unit_business_id: "ub-loja-15", unitBusiness: { id: "ub-loja-15", number: "15" } }),
    );

    const result = await resolveLoginAccess("token", [
      PdvAccessScreen.STORE_REQUEST,
      PdvAccessScreen.FINANCE,
    ]);

    expect(result?.screen).toBe(PdvAccessScreen.STORE_REQUEST);
    expect(result?.unitBusinessId).toBe("ub-loja-15");
  });
});
