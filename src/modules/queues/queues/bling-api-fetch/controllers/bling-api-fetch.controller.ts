import { QueuesController } from './../../../controller/queue.controller';
import { Request, Response } from "express";
import { authenticate } from "../../../../../middlewares/auth-token";
import blingApiFetchService from '../services/bling-api-fetch.service';

const BLING_API_FETCH_QUEUE = "BLING_API_FETCH";

export class BlingApiFetchController extends QueuesController {
  constructor() {
    super(blingApiFetchService);
  }

  protected middlewaresFor() {
    return {
      overview: [authenticate],
      jobs: [authenticate],
      retry: [authenticate],
      remove: [authenticate],
      pause: [authenticate],
      resume: [authenticate],
    };
  }

  protected registerRoutes(): void {
    this.router.get("/", ...this.mw("overview"), this.getOverview.bind(this));
    this.router.get("/jobs", ...this.mw("jobs"), this.getJobs.bind(this));
    this.router.post("/jobs/:jobId/retry", ...this.mw("retry"), this.retryJob.bind(this));
    this.router.delete("/jobs/:jobId", ...this.mw("remove"), this.removeJob.bind(this));
    this.router.post("/pause", ...this.mw("pause"), this.pause.bind(this));
    this.router.post("/resume", ...this.mw("resume"), this.resume.bind(this));
  }

  // métodos normais, não mais arrow-function fields
  async getOverview(_req: Request, res: Response): Promise<Response> {
    const overview = await this.service.getQueueOverview(BLING_API_FETCH_QUEUE);
    return res.json(overview);
  }

  async getJobs(req: Request, res: Response): Promise<Response> {
    const { status = "waiting", start = "0", end = "20" } = req.query as Record<string, string>;
    const jobs = await this.service.getJobs(BLING_API_FETCH_QUEUE, status as any, Number(start), Number(end));
    return res.json(jobs);
  }

  async retryJob(req: Request, res: Response): Promise<Response> {
    const { jobId } = req.params;
    const retried = await this.service.retryJob(BLING_API_FETCH_QUEUE, jobId as string);
    if (!retried) return res.status(404).json({ error: "Job não encontrado" });
    return res.json({ retried: true });
  }

  async removeJob(req: Request, res: Response): Promise<Response> {
    const { jobId } = req.params;
    const removed = await this.service.removeJob(BLING_API_FETCH_QUEUE, jobId as string);
    if (!removed) return res.status(404).json({ error: "Job não encontrado" });
    return res.status(204).send();
  }

  async pause(_req: Request, res: Response): Promise<Response> {
    await this.service.pauseQueue(BLING_API_FETCH_QUEUE);
    return res.json({ paused: true });
  }

  async resume(_req: Request, res: Response): Promise<Response> {
    await this.service.resumeQueue(BLING_API_FETCH_QUEUE);
    return res.json({ resumed: true });
  }
}

export default new BlingApiFetchController();