import { authenticate } from '../../../../middlewares/auth-token';
import { userPermissions } from "../../../../middlewares/user-permissions";
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
          create: [authenticate, userPermissions],
          update: [
            authenticate,
          ],
          show: [authenticate],
          destroy: [authenticate, userPermissions],
          removeBatchInvoice: [authenticate, userPermissions],
          // Ações do CRUD genérico sem chave aqui ficavam sem middleware nenhum.
          bulkCreate: [authenticate, userPermissions],
          bulkUpdate: [authenticate, userPermissions],
          bulkDestroy: [authenticate, userPermissions],
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
