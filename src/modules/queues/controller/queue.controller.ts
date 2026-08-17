import { Request, RequestHandler, Response } from "express";
import RouterController from "../../../shared/utils/base-models/base-router-controller";
import { QueueMonitorService } from "../services/queue.service";
import queueMonitorService from "../services/queue.service";
import { authenticate } from "../../../middlewares/auth-token";

export class QueuesController extends RouterController {
  protected service: QueueMonitorService;

  constructor(service: QueueMonitorService = queueMonitorService) {
    super();
    this.service = service;
    this.registerRoutes();
  }

  protected middlewaresFor(): Record<string, RequestHandler[]> {
    return {
      list: [authenticate],
      jobs: [authenticate],
    };
  }

  protected registerRoutes(): void {
    this.router.get("/", ...this.mw("list"), this.listQueues);
    this.router.get("/:name/jobs", ...this.mw("jobs"), this.getQueueJobs);
  }

  listQueues = async (_req: Request, res: Response): Promise<Response> => {
    const overview = await this.service.getAllQueuesOverview();
    return res.json(overview);
  };

  getQueueJobs = async (req: Request, res: Response): Promise<Response> => {
    const { name } = req.params;
    const { status = "waiting", start = "0", end = "20" } = req.query as Record<
      string,
      string
    >;
    const jobs = await this.service.getJobs(
      name as string,
      status as any,
      Number(start),
      Number(end),
    );
    return res.json(jobs);
  };
}

export default new QueuesController();