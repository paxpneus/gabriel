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
import { assertLinkParamsMatch, resolveLoginAccess } from "../resolve-pdv-access";
import { PdvAccessContext, PdvAccessScreen } from "../../pdv-access.types";

// Regra determinística (ver resolve-pdv-access.ts): NUNCA via
// ROLE_PERMISSIONS/userHasPermission — só user.type + unit_business.
function makeUser(overrides: Partial<any> = {}) {
  return {
    id: "user-1",
    unit_business_id: "ub-1",
    unitBusiness: { id: "ub-1", number: "09" },
    type: "operator",
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
      context: {
        screen: PdvAccessScreen.STORE_REQUEST,
        via: "LOGIN",
        unitBusinessId: "ub-loja-15",
        userId: "user-1",
      },
    });
  });

  it("user.type === 'finance' resolve FINANCE (global) mesmo a loja sendo uma loja física comum", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(
      makeUser({ type: "finance" }),
    );

    const result = await resolveLoginAccess("token", ALL_SCREENS);

    expect(result).toEqual({
      context: {
        screen: PdvAccessScreen.FINANCE,
        via: "LOGIN",
        unitBusinessId: null,
        userId: "user-1",
      },
    });
  });

  it("lê user.type (mesmo campo do front), não config.type", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(
      makeUser({ type: null, config: { type: "finance" } }),
    );

    const result = await resolveLoginAccess("token", ALL_SCREENS);

    expect(result).toEqual({
      context: expect.objectContaining({ screen: PdvAccessScreen.STORE_REQUEST }),
    });
  });

  it("unit business é a CD21 (number 21) e tipo não é finance — resolve CD21 (global)", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(
      makeUser({ unitBusiness: { id: "ub-cd21", number: "21" } }),
    );

    const result = await resolveLoginAccess("token", ALL_SCREENS);

    expect(result).toEqual({
      context: {
        screen: PdvAccessScreen.CD21,
        via: "LOGIN",
        unitBusinessId: null,
        userId: "user-1",
      },
    });
  });

  it("user.type === 'finance' tem prioridade sobre a loja ser a CD21", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(
      makeUser({
        unitBusiness: { id: "ub-cd21", number: "21" },
        type: "finance",
      }),
    );

    const result = await resolveLoginAccess("token", ALL_SCREENS);

    expect(result).toEqual({
      context: expect.objectContaining({ screen: PdvAccessScreen.FINANCE }),
    });
  });

  it.each(["12", "17"])(
    "loja %s (excluída do PDV) — 403 explícito, não cai pro link como 400",
    async (number) => {
      (userService.getMe as jest.Mock).mockResolvedValue(
        makeUser({ unitBusiness: { id: "ub-x", number } }),
      );

      const result = await resolveLoginAccess("token", ALL_SCREENS);

      expect(result).toEqual({ error: expect.objectContaining({ status: 403 }) });
    },
  );

  it("financeiro lotado na loja 12 continua resolvendo FINANCE", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(
      makeUser({
        unitBusiness: { id: "ub-12", number: "12" },
        type: "finance",
      }),
    );

    const result = await resolveLoginAccess("token", ALL_SCREENS);

    expect(result).toEqual({
      context: expect.objectContaining({ screen: PdvAccessScreen.FINANCE }),
    });
  });

  it("usuário sem unit business e sem config.type finance — sem tela nenhuma, retorna null", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(
      makeUser({ unit_business_id: null, unitBusiness: null }),
    );

    const result = await resolveLoginAccess("token", ALL_SCREENS);

    expect(result).toBeNull();
  });

  it("tela resolvida não está entre as exigidas pela rota — 403 explícito", async () => {
    (userService.getMe as jest.Mock).mockResolvedValue(makeUser());

    const result = await resolveLoginAccess("token", [PdvAccessScreen.FINANCE]);

    expect(result).toEqual({ error: expect.objectContaining({ status: 403 }) });
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

    expect(result).toEqual({
      context: expect.objectContaining({
        screen: PdvAccessScreen.STORE_REQUEST,
        unitBusinessId: "ub-loja-15",
      }),
    });
  });
});

describe("assertLinkParamsMatch", () => {
  const storeLink: PdvAccessContext = {
    screen: PdvAccessScreen.STORE_REQUEST,
    via: "STORE_LINK",
    unitBusinessId: "ub-24",
  };
  const cd21Link: PdvAccessContext = {
    screen: PdvAccessScreen.CD21,
    via: "STORE_LINK",
    unitBusinessId: null,
  };
  const financeLink: PdvAccessContext = {
    screen: PdvAccessScreen.FINANCE,
    via: "STORE_LINK",
    unitBusinessId: null,
  };
  const telesalesLink: PdvAccessContext = {
    screen: PdvAccessScreen.STORE_REQUEST,
    via: "TELESALES_LINK",
    unitBusinessId: null,
  };

  it("sem screen/number na URL — ok (opcionais por enquanto)", () => {
    expect(assertLinkParamsMatch(storeLink, {}, "24")).toBeNull();
  });

  it.each([
    [storeLink, "store_request", "24"],
    [cd21Link, "cd21", "21"],
    [financeLink, "finance", undefined],
    [telesalesLink, "telesales", undefined],
  ])("screen/number batendo com o token — ok (%#)", (context, screen, number) => {
    expect(
      assertLinkParamsMatch(context, { screen, number }, number ?? undefined),
    ).toBeNull();
  });

  it("screen desconhecido → 400", () => {
    expect(assertLinkParamsMatch(storeLink, { screen: "admin" }, "24")).toEqual(
      expect.objectContaining({ status: 400 }),
    );
  });

  it("screen de outra tela → 403", () => {
    expect(assertLinkParamsMatch(storeLink, { screen: "cd21" }, "24")).toEqual(
      expect.objectContaining({ status: 403 }),
    );
    expect(
      assertLinkParamsMatch(telesalesLink, { screen: "store_request" }, undefined),
    ).toEqual(expect.objectContaining({ status: 403 }));
  });

  it("number diferente do que validou o token → 403", () => {
    expect(assertLinkParamsMatch(storeLink, { number: "09" }, "24")).toEqual(
      expect.objectContaining({ status: 403 }),
    );
  });

  it.each([financeLink, telesalesLink])(
    "number em link global (financeiro/televendas) → 403",
    (context) => {
      expect(assertLinkParamsMatch(context, { number: "24" }, undefined)).toEqual(
        expect.objectContaining({ status: 403 }),
      );
    },
  );
});
