import { authenticate } from '../../../../middlewares/auth-token';
import BaseController from '../../../../shared/utils/base-models/base-controller';
import ExpeditionBatchInvoice from './batch-invoices.model';
import ExpeditionBatchInvoiceService from './batch-invoices.service';
import { Request, Response } from 'express';

export class ExpeditionBatchInvoiceController extends BaseController<ExpeditionBatchInvoice, typeof ExpeditionBatchInvoiceService> {
  constructor() {
    super(ExpeditionBatchInvoiceService);

    this.router.delete("/remove/:id", this.removeBatchInvoice)
  }

    protected middlewaresFor() {
        return {
          index: [authenticate],
          create: [authenticate],
          update: [
            authenticate,
          ],
          show: [authenticate],
          destroy: [authenticate],
          removeBatchInvoice: [authenticate]
        };
      }

      removeBatchInvoice = async (req: Request, res: Response): Promise<Response> => {
    try {
      const {id} = req.params

      await this.service.removeBatchInvoice(id as string)

    return res.status(201).json({ message: "Nota removida com sucesso!" });
    } catch (error: any) {
      return res.status(400).json({error: error.message})
    }
  }

}

export default new ExpeditionBatchInvoiceController();
