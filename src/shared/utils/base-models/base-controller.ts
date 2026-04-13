import { Request, Response, Router, RequestHandler } from "express";
import { Model } from "sequelize";
import BaseService from "./base-service";

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

  protected middlewaresFor(): Partial<
    Record<
      "index" | "show" | "create" | "bulkCreate" | "update" | "destroy",
      RequestHandler[]
    >
  > {
    return {};
  }

  private registerBaseRoutes(): void {
    const mw = this.middlewaresFor();

    this.router.get("/", ...(mw.index ?? []), (req, res) =>
      this.index(req, res),
    );
    this.router.get("/:id", ...(mw.show ?? []), (req, res) =>
      this.show(req, res),
    );
    this.router.post("/", ...(mw.create ?? []), (req, res) =>
      this.create(req, res),
    );
    this.router.post("/bulk", ...(mw.bulkCreate ?? []), (req, res) =>
      this.bulkCreate(req, res),
    );
    this.router.put("/:id", ...(mw.update ?? []), (req, res) =>
      this.update(req, res),
    );
    this.router.delete("/:id", ...(mw.destroy ?? []), (req, res) =>
      this.destroy(req, res),
    );
  }

  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const records = await this.service.findAll();
      return res.json(records);
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
