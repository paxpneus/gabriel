jest.mock("../helpers/resolve-pdv-access", () => ({
  __esModule: true,
  resolveLoginAccess: jest.fn(),
  resolveLinkAccess: jest.fn(),
}));

import { resolveLinkAccess } from "../helpers/resolve-pdv-access";
import { authenticateOrPdvLink } from "../pdv-access.middleware";
import { PdvAccessScreen } from "../pdv-access.types";

function makeReq(headers: Record<string, string> = {}) {
  return { header: (n: string) => headers[n.toLowerCase()] } as any;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// Encadeia os handlers como o Express faz (next avança, resposta/erro para).
async function runChain(handlers: any[], req: any, res: any, done: jest.Mock) {
  for (const h of handlers) {
    let advanced = false;
    await h(req, res, (err?: any) => {
      advanced = !err;
    });
    if (!advanced) return;
  }
  done();
}

describe("authenticateOrPdvLink", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sem x-pdv-token: rejeição do middleware de login propaga (Express 5 captura)", async () => {
    const boom = jest.fn().mockRejectedValue(new Error("boom"));
    const [h] = authenticateOrPdvLink([PdvAccessScreen.CD21], [boom]);

    await expect(h(makeReq(), makeRes(), jest.fn())).rejects.toThrow("boom");
  });

  it("sem x-pdv-token: roda os middlewares de login em ordem e nunca olha o link", async () => {
    const order: string[] = [];
    const a = jest.fn((_q, _r, n) => (order.push("a"), n()));
    const b = jest.fn((_q, _r, n) => (order.push("b"), n()));
    const next = jest.fn();

    await runChain(
      authenticateOrPdvLink([PdvAccessScreen.CD21], [a, b]),
      makeReq(),
      makeRes(),
      next,
    );

    expect(order).toEqual(["a", "b"]);
    expect(next).toHaveBeenCalled();
    expect(resolveLinkAccess).not.toHaveBeenCalled();
  });

  it("sem x-pdv-token: middleware de login que responde (401) interrompe a cadeia", async () => {
    const a = jest.fn((_q, res) => { res.status(401); });
    const b = jest.fn();
    const next = jest.fn();

    await runChain(
      authenticateOrPdvLink([PdvAccessScreen.CD21], [a, b]),
      makeReq(),
      makeRes(),
      next,
    );

    expect(b).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("link CD21 válido: seta pdvAccess e pula os middlewares de login", async () => {
    (resolveLinkAccess as jest.Mock).mockResolvedValue({
      context: {
        screen: PdvAccessScreen.CD21,
        via: "STORE_LINK",
        unitBusinessId: null,
      },
    });
    const login = jest.fn();
    const req = makeReq({
      "x-pdv-token": "tok",
      "x-pdv-unit-business-number": "21",
    });
    const next = jest.fn();

    await runChain(
      authenticateOrPdvLink([PdvAccessScreen.CD21], [login, login]),
      req,
      makeRes(),
      next,
    );

    expect(resolveLinkAccess).toHaveBeenCalledWith("21", "tok", [
      PdvAccessScreen.CD21,
    ]);
    expect(req.pdvAccess.screen).toBe(PdvAccessScreen.CD21);
    expect(login).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
  });

  it("link inválido (token de outra tela/loja): bloqueia sem cair no login", async () => {
    (resolveLinkAccess as jest.Mock).mockResolvedValue({
      error: { status: 401, message: "Token de acesso inválido." },
    });
    const login = jest.fn();
    const res = makeRes();
    const next = jest.fn();

    await runChain(
      authenticateOrPdvLink([PdvAccessScreen.CD21], [login]),
      makeReq({ "x-pdv-token": "bad", "x-pdv-unit-business-number": "05" }),
      res,
      next,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
    expect(login).not.toHaveBeenCalled();
  });
});
