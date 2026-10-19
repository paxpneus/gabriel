jest.mock("../../../modules/company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

import { Op } from "sequelize";
import unitBusinessService from "../../../modules/company/unit-business/unit-business.service";
import BaseController, { StoreNumberField } from "../../utils/base-models/base-controller";
import { parseStoreNumbers, resolveApplicationStoreFilter, StoreNumberError } from "../store-number";

const findAll = unitBusinessService.findAll as jest.Mock;

const app = (query: Record<string, unknown> = {}) =>
  ({ application: { id: "app" }, query, params: {}, body: {} }) as any;

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

// Controller de teste com opt-in configurável do store_number.
function makeController(field: StoreNumberField | null) {
  const service = { paginate: jest.fn().mockResolvedValue({ data: [] }) } as any;
  class TestController extends BaseController<any, any> {
    protected storeNumberField() {
      return field;
    }
  }
  return { controller: new TestController(service) as any, service };
}

describe("parseStoreNumbers", () => {
  it("aceita vírgula, array e remove repetidos/vazios", () => {
    expect(parseStoreNumbers("02,03")).toEqual(["02", "03"]);
    expect(parseStoreNumbers(["02", "03,02", " "])).toEqual(["02", "03"]);
  });

  it("vazio → null; formato inválido → 400", () => {
    expect(parseStoreNumbers(undefined)).toBeNull();
    expect(parseStoreNumbers("")).toBeNull();
    expect(() => parseStoreNumbers({ a: 1 })).toThrow(StoreNumberError);
  });
});

describe("resolveApplicationStoreFilter", () => {
  it("usuário logado ou application sem store_number → null (sem consulta)", async () => {
    await expect(
      resolveApplicationStoreFilter({ user: { id: "u" }, query: { store_number: "02" } } as any),
    ).resolves.toBeNull();
    await expect(resolveApplicationStoreFilter(app())).resolves.toBeNull();
    expect(findAll).not.toHaveBeenCalled();
  });

  it("resolve várias lojas numa query e devolve ids + integrações", async () => {
    findAll.mockResolvedValue([
      { id: "ub-02", number: "02", integrations_id: "int-T" },
      { id: "ub-03", number: "03", integrations_id: "int-T" },
    ]);
    await expect(resolveApplicationStoreFilter(app({ store_number: "02,03" }))).resolves.toEqual({
      unitBusinessIds: ["ub-02", "ub-03"],
      integrationsIds: ["int-T"],
    });
    expect(findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { number: { [Op.in]: ["02", "03"] } } }),
    );
  });

  it("loja inexistente → 404", async () => {
    findAll.mockResolvedValue([{ id: "ub-02", number: "02", integrations_id: "int-T" }]);
    await expect(resolveApplicationStoreFilter(app({ store_number: "02,99" }))).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe("BaseController.index com store_number", () => {
  beforeEach(() => {
    findAll.mockResolvedValue([
      { id: "ub-02", number: "02", integrations_id: "int-T" },
      { id: "ub-21", number: "21", integrations_id: "int-B" },
    ]);
  });

  it("controller sem opt-in mantém o index original", async () => {
    const { controller, service } = makeController(null);
    await controller.index(app({ store_number: "02,21" }), makeRes());
    expect(service.paginate).toHaveBeenCalledWith(expect.anything());
    expect(findAll).not.toHaveBeenCalled();
  });

  it("opt-in unit_business_id filtra pelas lojas", async () => {
    const { controller, service } = makeController("unit_business_id");
    await controller.index(app({ store_number: "02,21" }), makeRes());
    expect(service.paginate).toHaveBeenCalledWith(expect.anything(), undefined, {
      unit_business_id: { [Op.in]: ["ub-02", "ub-21"] },
    });
  });

  it("opt-in integrations_id filtra pelas integrações das lojas", async () => {
    const { controller, service } = makeController("integrations_id");
    await controller.index(app({ store_number: "02,21" }), makeRes());
    expect(service.paginate).toHaveBeenCalledWith(expect.anything(), undefined, {
      integrations_id: { [Op.in]: ["int-T", "int-B"] },
    });
  });

  it("sem store_number o index é o original", async () => {
    const { controller, service } = makeController("unit_business_id");
    await controller.index(app(), makeRes());
    expect(service.paginate).toHaveBeenCalledWith(expect.anything());
  });

  it("store_number inexistente responde 404", async () => {
    findAll.mockResolvedValue([]);
    const { controller } = makeController("unit_business_id");
    const res = makeRes();
    await controller.index(app({ store_number: "99" }), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });
});
