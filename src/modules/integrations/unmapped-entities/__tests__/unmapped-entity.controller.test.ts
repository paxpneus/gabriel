jest.mock("../../../../middlewares/auth-token", () => ({ authenticate: jest.fn() }));
jest.mock("../../../../middlewares/user-permissions", () => ({ userPermissions: jest.fn() }));
// setup.ts mocka o pacote uuid inteiro (sem validate): validador com regex equivalente.
jest.mock("../../../../shared/utils/validators/uuid", () => ({
  assertUuid: (value: unknown, label = "Identificador") => {
    const ok = typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
    if (!ok) throw new Error(`${label} inválido`);
    return value;
  },
}));
jest.mock("../unmapped-entity.service", () => ({
  __esModule: true,
  default: { map: jest.fn() },
}));

import controller from "../unmapped-entity.controller";
import unmappedEntityService from "../unmapped-entity.service";

const PENDING_ID = "0f6d1c2e-3a4b-4c5d-8e9f-0a1b2c3d4e5f";
const METHOD_ID = "361b5640-ec04-4b3f-8191-fe3ac5f134c4";

function fakeRes() {
  const res: any = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
}

describe("UnmappedEntityController", () => {
  beforeEach(() => jest.clearAllMocks());

  it("POST /:id/map: 201 com o mapping, passando o usuário logado", async () => {
    (unmappedEntityService.map as jest.Mock).mockResolvedValue({ id: "m1" });
    const res = fakeRes();
    await controller.map(
      { params: { id: PENDING_ID }, body: { internal_id: METHOD_ID }, user: { id: "user-1" } } as any,
      res,
    );
    expect(unmappedEntityService.map).toHaveBeenCalledWith(PENDING_ID, METHOD_ID, "user-1");
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: "m1" });
  });

  it("POST /:id/map: application não tem userId (null)", async () => {
    (unmappedEntityService.map as jest.Mock).mockResolvedValue({ id: "m1" });
    await controller.map(
      { params: { id: PENDING_ID }, body: { internal_id: METHOD_ID }, application: { id: "app" } } as any,
      fakeRes(),
    );
    expect(unmappedEntityService.map).toHaveBeenCalledWith(PENDING_ID, METHOD_ID, null);
  });

  it("POST /:id/map: 404 quando a pendência não existe", async () => {
    (unmappedEntityService.map as jest.Mock).mockResolvedValue(null);
    const res = fakeRes();
    await controller.map({ params: { id: PENDING_ID }, body: { internal_id: METHOD_ID } } as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Pendência não encontrada" });
  });

  it("POST /:id/map: 400 com id ou internal_id inválido, sem chamar o service", async () => {
    const res = fakeRes();
    await controller.map({ params: { id: "abc" }, body: { internal_id: METHOD_ID } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);

    const res2 = fakeRes();
    await controller.map({ params: { id: PENDING_ID }, body: {} } as any, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
    expect(unmappedEntityService.map).not.toHaveBeenCalled();
  });

  it("POST /:id/map: 400 com a mensagem do service (ex.: código já mapeado)", async () => {
    (unmappedEntityService.map as jest.Mock).mockRejectedValue(new Error("O código 1 no ERP já está mapeado para outro registro"));
    const res = fakeRes();
    await controller.map({ params: { id: PENDING_ID }, body: { internal_id: METHOD_ID } } as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "O código 1 no ERP já está mapeado para outro registro" });
  });

  it("CRUD genérico de escrita responde 405", async () => {
    for (const action of ["create", "bulkCreate", "update", "bulkUpdate", "destroy", "bulkDestroy"] as const) {
      const res = fakeRes();
      await (controller as any)[action]({} as any, res);
      expect(res.status).toHaveBeenCalledWith(405);
    }
  });
});
