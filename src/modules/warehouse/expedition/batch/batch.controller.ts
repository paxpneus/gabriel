import { Request, Response } from 'express';
import BaseController from '../../../../shared/utils/base-models/base-controller';
import ExpeditionBatch from './batch.model';
import ExpeditionBatchService from './batch.service';

export class ExpeditionBatchController extends BaseController<ExpeditionBatch, typeof ExpeditionBatchService> {
  constructor() {
    super(ExpeditionBatchService);
    this.registerCustomRoutes();
  }

  private registerCustomRoutes(): void {
    // POST /expedition-batches/generate-from-invoices
    this.router.post('/generate-from-invoices', (req, res) =>
      this.generateBatchesFromInvoices(req, res)
    );
  }

  /**
   * POST /expedition-batches/generate-from-invoices
   * Body: { invoiceIds: string[] }
   */
  generateBatchesFromInvoices = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { invoiceIds } = req.body;

      if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
        return res.status(400).json({ error: 'Informe ao menos uma nota fiscal (invoiceIds).' });
      }

      const batches = await ExpeditionBatchService.generateBatchFromInvoices(invoiceIds);
      return res.status(201).json(batches);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new ExpeditionBatchController();