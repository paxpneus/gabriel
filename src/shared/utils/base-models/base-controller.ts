import { Request, Response, Router, RequestHandler } from "express";
import { Model, Op, WhereOptions } from "sequelize";
import BaseService from "./base-service";
import RouterController from "./base-router-controller";
import {
  resolveApplicationStoreFilter,
  storeNumberErrorStatus,
} from "../../query/store-number";

// Coluna que o ?store_number= de application filtra no index (opt-in por controller).
export type StoreNumberField = "unit_business_id" | "integrations_id";
class BaseController<
  T extends Model,
  Tservice extends BaseService<T> = BaseService<T>,
> extends RouterController {
  protected service: Tservice;

  constructor(service: Tservice) {
    super();
    this.service = service;
    this.registerBaseRoutes();
    
  }

  // Opt-in do filtro ?store_number= de application no index; null = index original.
  protected storeNumberField(): StoreNumberField | null {
    return null;
  }

  // where do store_number (só application que mandou o parâmetro); undefined = sem filtro.
  protected async storeNumberWhere(req: Request): Promise<WhereOptions | undefined> {
    const field = this.storeNumberField();
    if (!field) return undefined;

    const filter = await resolveApplicationStoreFilter(req);
    if (!filter) return undefined;

    const ids =
      field === "unit_business_id" ? filter.unitBusinessIds : filter.integrationsIds;
    return { [field]: { [Op.in]: ids } };
  }

  private registerBaseRoutes(): void {
    this.router.get("/", ...this.mw("index"), (req, res) =>
      this.index(req, res),
    );
    this.router.get("/:id", ...this.mw("show"), (req, res) =>
      this.show(req, res),
    );
    this.router.post("/", ...this.mw("create"), (req, res) =>
      this.create(req, res),
    );
    this.router.post("/bulk", ...this.mw("bulkCreate"), (req, res) =>
      this.bulkCreate(req, res),
    );
    this.router.put("/:id", ...this.mw("update"), (req, res) =>
      this.update(req, res),
    );

    this.router.put("/bulk", ...this.mw("bulkUpdate"), (req, res) => this.bulkUpdate(req, res))

     this.router.delete("/bulk", ...this.mw("bulkDestroy"), (req, res) =>
  this.bulkDestroy(req, res),
);
    this.router.delete("/:id", ...this.mw("destroy"), (req, res) =>
      this.destroy(req, res),
    );
   
  }

  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const storeWhere = await this.storeNumberWhere(req);
      const result = storeWhere
        ? await this.service.paginate(params, undefined, storeWhere)
        : await this.service.paginate(params);
      return res.json(result);
    } catch (error: any) {
      return res.status(storeNumberErrorStatus(error, 500)).json({ error: error.message });
    }
  };

  show = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.findById(req.params.id as string);
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.create(req.body);
      return res.status(201).json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  bulkCreate = async (req: Request, res: Response): Promise<Response> => {
    try {
      const records = await this.service.bulkCreate(req.body);
      return res.status(201).json(records);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  update = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.update(
        req.params.id as string,
        req.body,
      );
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  bulkUpdate = async (req: Request, res: Response): Promise<Response> => {
    try {
      const records = await this.service.bulkUpdate(req.body, {
        where: {
          id: req.body.ids
        }
      });
      return res.status(201).json(records);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  destroy = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.delete(req.params.id as string);
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.status(204).send();
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  bulkDestroy = async (req: Request, res: Response): Promise<Response> => {
  try {
    const { ids } = req.body as { ids: string[] };

    if (!Array.isArray(ids) || ids.length === 0) {
      return res.status(400).json({ error: "Informe um array de ids válido." });
    }

    const deleted = await this.service.bulkDelete({
      where: { id: { [Op.in]: ids } },
    });

    return res.json({ deleted });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
};
}

export default BaseController;
