import { Request, Response, Router, RequestHandler } from "express";
import { Model } from "sequelize";
import BaseService from "./base-service";
import { QueryParams } from "../../query/query.types";
class BaseController<
  T extends Model,
  Tservice extends BaseService<T> = BaseService<T>,
> {
  public router: Router;
  protected service: Tservice;

  constructor(service: Tservice) {
    this.service = service;
    this.router = Router();
    this.registerBaseRoutes();
  }

  protected middlewaresFor(): Record<string, RequestHandler[]> {
    return {};
  }

  protected mw(key: string): RequestHandler[] {
    return this.middlewaresFor()[key] ?? [];
  }

  protected extractQueryParams(req: Request): QueryParams {
    const q = req.query as Record<string, any>;
    return {
      page: q.page,
      perPage: q.perPage,
      sortBy: q.sortBy,
      sortDir: q.sortDir,
      search: q.search,
      filters: q.filters,
      dateFrom: q.dateFrom,
      dateTo: q.dateTo,
      dateField: q.dateField,
    };
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
    this.router.delete("/:id", ...this.mw("destroy"), (req, res) =>
      this.destroy(req, res),
    );
  }

  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const result = await this.service.paginate(params);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
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

  destroy = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.delete(req.params.id as string);
      if (!record) return res.status(404).json({ error: "Não encontrado" });
      return res.status(204).send();
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default BaseController;
