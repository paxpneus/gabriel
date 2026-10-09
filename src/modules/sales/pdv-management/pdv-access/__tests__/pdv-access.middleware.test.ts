jest.mock("../../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: {},
}));

jest.mock("../../../../company/users/users/user.service", () => ({
  __esModule: true,
  default: {},
}));

jest.mock("../helpers/resolve-pdv-access", () => ({
  __esModule: true,
  resolveLoginAccess: jest.fn(),
  resolveLinkAccess: jest.fn(),
  assertLinkParamsMatch: jest.requireActual("../helpers/resolve-pdv-access")
    .assertLinkParamsMatch,
}));

import {
  resolveLinkAccess,
  resolveLoginAccess,
} from "../helpers/resolve-pdv-access";
import { pdvAccess, pdvLoginAccess } from "../pdv-access.middleware";
import { PdvAccessScreen } from "../pdv-access.types";

function makeReq(
  headers: Record<string, string> = {},
  query: Record<string, unknown> = {},
) {
  return {
    cookies: { token: "cookie" },
    header: (n: string) => headers[n.toLowerCase()],
    query,
  } as any;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

const forbidden = { error: { status: 403, message: "sem acesso" } };
const storeLinkContext = {
  screen: PdvAccessScreen.STORE_REQUEST,
  via: "STORE_LINK",
  unitBusinessId: "ub-24",
};

describe("pdvAccess", () => {
  beforeEach(() => jest.clearAllMocks());

  it("login sem acesso (loja 12/17) e sem x-pdv-token → 403, sem tentar o link", async () => {
    (resolveLoginAccess as jest.Mock).mockResolvedValue(forbidden);
    const res = makeRes();
    const next = jest.fn();

    await pdvAccess([PdvAccessScreen.STORE_REQUEST])(makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
    expect(resolveLinkAccess).not.toHaveBeenCalled();
  });

  it("login sem acesso mas com x-pdv-token → o link decide", async () => {
    (resolveLoginAccess as jest.Mock).mockResolvedValue(forbidden);
    (resolveLinkAccess as jest.Mock).mockResolvedValue({ context: storeLinkContext });
    const req = makeReq({ "x-pdv-token": "t", "x-pdv-unit-business-number": "24" });
    const next = jest.fn();

    await pdvAccess([PdvAccessScreen.STORE_REQUEST])(req, makeRes(), next);

    expect(next).toHaveBeenCalled();
    expect(req.pdvAccess).toEqual(storeLinkContext);
  });

  it("link com ?screen= de outra tela → 403", async () => {
    (resolveLoginAccess as jest.Mock).mockResolvedValue(null);
    (resolveLinkAccess as jest.Mock).mockResolvedValue({ context: storeLinkContext });
    const res = makeRes();
    const next = jest.fn();

    await pdvAccess([PdvAccessScreen.STORE_REQUEST])(
      makeReq(
        { "x-pdv-token": "t", "x-pdv-unit-business-number": "24" },
        { screen: "finance" },
      ),
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("link com ?number= diferente do header → 403", async () => {
    (resolveLoginAccess as jest.Mock).mockResolvedValue(null);
    (resolveLinkAccess as jest.Mock).mockResolvedValue({ context: storeLinkContext });
    const res = makeRes();

    await pdvAccess([PdvAccessScreen.STORE_REQUEST])(
      makeReq(
        { "x-pdv-token": "t", "x-pdv-unit-business-number": "24" },
        { screen: "store_request", number: "09" },
      ),
      res,
      jest.fn(),
    );

    expect(res.status).toHaveBeenCalledWith(403);
  });
});

describe("pdvLoginAccess", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sem login (só link x-pdv-token) → 401, link nunca é consultado", async () => {
    (resolveLoginAccess as jest.Mock).mockResolvedValue(null);
    const res = makeRes();
    const next = jest.fn();

    await pdvLoginAccess([PdvAccessScreen.CD21])(
      makeReq({ "x-pdv-token": "t", "x-pdv-unit-business-number": "21" }),
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(resolveLinkAccess).not.toHaveBeenCalled();
  });

  it("login de outra tela → status/mensagem do login", async () => {
    (resolveLoginAccess as jest.Mock).mockResolvedValue(forbidden);
    const res = makeRes();
    const next = jest.fn();

    await pdvLoginAccess([PdvAccessScreen.CD21])(makeReq(), res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "sem acesso" });
    expect(next).not.toHaveBeenCalled();
  });

  it("login CD21 → segue com o contexto do usuário", async () => {
    const context = {
      screen: PdvAccessScreen.CD21,
      via: "LOGIN",
      unitBusinessId: null,
      userId: "user-1",
    };
    (resolveLoginAccess as jest.Mock).mockResolvedValue({ context });
    const req = makeReq();
    const next = jest.fn();

    await pdvLoginAccess([PdvAccessScreen.CD21])(req, makeRes(), next);

    expect(next).toHaveBeenCalled();
    expect(req.pdvAccess).toEqual(context);
  });
});
