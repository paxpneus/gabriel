import { Request, Response } from "express";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import ExpeditionBatch from "./batch.model";
import ExpeditionBatchService from "./batch.service";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";

export class ExpeditionBatchController extends BaseController<
  ExpeditionBatch,
  typeof ExpeditionBatchService
> {
  constructor() {
    super(ExpeditionBatchService);
    this.registerCustomRoutes();
  }

  protected middlewaresFor() {
      return {
        index: [authenticate, userPermissions],
        create: [authenticate, userPermissions],
        update: [authenticate, userPermissions],
        show: [authenticate, userPermissions],
        destroy: [authenticate, userPermissions],
        generateBatchesFromInvoices: [authenticate, userPermissions],
        getBatchesByInvoice: [authenticate, userPermissions],
        getBatches: [authenticate, userPermissions],
        getFullBatch: [authenticate, userPermissions],
        addInvoiceToBatch: [authenticate, userPermissions]
      };
    }

  private registerCustomRoutes(): void {
    // POST /expedition-batches/generate-from-invoices
    this.router.post("/generate-from-invoices",  ...this.mw("generateBatchesFromInvoices"), (req, res) =>
      this.generateBatchesFromInvoices(req, res),
    );

    this.router.get("/by-invoices/get", ...this.mw("getBatchesByInvoice"), this.getBatchesByInvoice);
    this.router.get("/by-ids/get", ...this.mw("getBatches"), this.getBatches)

    this.router.get("/full/get", ...this.mw("getFullBatch"), this.getFullBatch)

    this.router.post("/add-invoice", ...this.mw("addInvoiceToBatch"), (req, res) => this.addInvoiceToBatch(req, res))
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
      const { invoiceIds, unitBusinessId, type } = req.body;
      if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
        return res
          .status(400)
          .json({ error: "Informe ao menos uma nota fiscal" });
      }

      const batches =
        await ExpeditionBatchService.generateBatchFromInvoices(invoiceIds, unitBusinessId, type);
      return res.status(201).json(batches);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

    addInvoiceToBatch = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      const { invoiceKey, unitBusinessId , type, batchId } = req.body;
    
      const batches =
        await ExpeditionBatchService.addInvoiceToBatch(invoiceKey, unitBusinessId, type, batchId);
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

  getBatches = async (
    req: Request,
    res: Response,
  ): Promise<Response> => {
    try {
      let ids: string[] = [];

      if (Array.isArray(req.query.batchesIds)) {
        ids = req.query.batchesIds as string[];
      } else if (typeof req.query.batchesIds === "string") {
        ids = req.query.batchesIds
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      if (!ids.length) {
        return res.status(400).json({ error: "Nenhum lote informado." });
      }

      const batches = await this.service.getBatches(ids);
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
