jest.mock("../../modules/sales/pdv-management/pdv-access/helpers/resolve-pdv-access", () => ({
  __esModule: true,
  resolveLinkAccess: jest.fn(),
}));

import { resolveLinkAccess } from "../../modules/sales/pdv-management/pdv-access/helpers/resolve-pdv-access";
import { PdvAccessScreen } from "../../modules/sales/pdv-management/pdv-access/pdv-access.types";

const ALLOWED_ORIGIN = "https://hub.example.com";

// allowedOrigins é lido no load do módulo — env setada antes do require.
let externalApiAccess: typeof import("../external-api-access").externalApiAccess;
beforeAll(() => {
  process.env.ALLOWED_ORIGINS = ALLOWED_ORIGIN;
  externalApiAccess = require("../external-api-access").externalApiAccess;
});

// GET fora dos prefixos isentos, sem Origin/cookie/Bearer/api-key por padrão.
function makeReq({
  headers = {},
  cookies = {},
  url = "/api/payment_method",
}: {
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  url?: string;
} = {}) {
  return {
    originalUrl: url,
    headers,
    cookies,
    header: (n: string) => headers[n.toLowerCase()],
  } as any;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const pdvHeaders = {
  "x-pdv-token": "tok",
  "x-pdv-unit-business-number": "24",
};

describe("externalApiAccess", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sem Origin/cookie, com x-pdv-token válido → next, validando com todas as telas", async () => {
    (resolveLinkAccess as jest.Mock).mockResolvedValue({
      context: { screen: PdvAccessScreen.STORE_REQUEST, via: "STORE_LINK", unitBusinessId: "ub-24" },
    });
    const res = makeRes();
    const next = jest.fn();

    await externalApiAccess(makeReq({ headers: pdvHeaders }), res, next);

    expect(resolveLinkAccess).toHaveBeenCalledWith(
      "24",
      "tok",
      Object.values(PdvAccessScreen),
    );
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("x-pdv-token inválido → 401", async () => {
    (resolveLinkAccess as jest.Mock).mockResolvedValue({
      error: { status: 401, message: "Token de acesso inválido." },
    });
    const res = makeRes();
    const next = jest.fn();

    await externalApiAccess(makeReq({ headers: pdvHeaders }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("erro inesperado na validação do token → 500 tratado, sem rejeitar", async () => {
    (resolveLinkAccess as jest.Mock).mockRejectedValue(new Error("db down"));
    const res = makeRes();
    const next = jest.fn();

    await expect(
      externalApiAccess(makeReq({ headers: pdvHeaders }), res, next),
    ).resolves.not.toThrow();

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("sem x-pdv-token e sem nenhuma credencial → 401, sem validar link", async () => {
    const res = makeRes();
    const next = jest.fn();

    await externalApiAccess(makeReq(), res, next);

    expect(resolveLinkAccess).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("Origin permitido → next, sem validar link", async () => {
    const res = makeRes();
    const next = jest.fn();

    await externalApiAccess(
      makeReq({ headers: { origin: ALLOWED_ORIGIN } }),
      res,
      next,
    );

    expect(resolveLinkAccess).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("cookie token → next, sem validar link", async () => {
    const res = makeRes();
    const next = jest.fn();

    await externalApiAccess(makeReq({ cookies: { token: "jwt" } }), res, next);

    expect(resolveLinkAccess).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("rota pública unit-business/public/list sem nenhuma credencial → next", async () => {
    const res = makeRes();
    const next = jest.fn();

    await externalApiAccess(
      makeReq({ url: "/api/unit-business/public/list?page=1&perPage=1000" }),
      res,
      next,
    );

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("Origin não permitido e sem credencial → 401", async () => {
    const res = makeRes();
    const next = jest.fn();

    await externalApiAccess(
      makeReq({ headers: { origin: "https://evil.example.com" } }),
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
