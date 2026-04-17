import { Request, Response } from "express";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import ExpeditionBatch from "./batch.model";
import ExpeditionBatchService from "./batch.service";

export class ExpeditionBatchController extends BaseController<
  ExpeditionBatch,
  typeof ExpeditionBatchService
> {
  constructor() {
    super(ExpeditionBatchService);
    this.registerCustomRoutes();
  }

  private registerCustomRoutes(): void {
    // POST /expedition-batches/generate-from-invoices
    this.router.post("/generate-from-invoices", (req, res) =>
      this.generateBatchesFromInvoices(req, res),
    );

    this.router.get("/by-invoices/get", this.getBatchesByInvoice);

    this.router.get("/full/get", this.getFullBatch)
  }

  /**
   * POST /expedition-batches/generate-from-invoices
   * Body: { invoiceIds: string[] }
   */
  generateBatchesFromInvoices = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { invoiceIds } = req.params;

      if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
        return res
          .status(400)
          .json({ error: "Informe ao menos uma nota fiscal (invoiceIds)." });
      }

      const batches =
        await ExpeditionBatchService.generateBatchFromInvoices(invoiceIds);
      return res.status(201).json(batches);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  getBatchesByInvoice = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      let ids: string[] = [];

      if (Array.isArray(req.query.invoiceIds)) {
        ids = req.query.invoiceIds as string[];
      } else if (typeof req.query.invoiceIds === "string") {
        ids = req.query.invoiceIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      if (!ids.length) {
        return res.status(400).json({ error: "Nenhum invoiceId informado." });
      }

      const batches = await this.service.getBatchesByInvoiceIds(ids);
      return res.json(batches);
    } catch (err: any) {
      return res.status(400).json({ error: err.message });
    }
  };

  getFullBatch = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { batchId, number } = req.query

      console.log(batchId, number)

      const fullBatch = await this.service.findByIdFullBatch(batchId as string ?? '', number as string ?? '')

      return res.json(fullBatch);

    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new ExpeditionBatchController();
