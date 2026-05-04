import { authenticate } from '../../../../middlewares/auth-token';
import BaseController from '../../../../shared/utils/base-models/base-controller';
import InvoiceItems from './invoice-items.model';
import InvoiceItemsService from './invoice-items.service';
import { Request, Response } from "express";

export class InvoiceItemsController extends BaseController<InvoiceItems, typeof InvoiceItemsService> {
  constructor() {
    super(InvoiceItemsService);

    this.router.post("/add/item", this.createInvoiceItem)
  }

   protected middlewaresFor() {
        return {
          index: [authenticate],
          create: [authenticate],
          update: [
            authenticate
          ],
          show: [authenticate],
          destroy: [authenticate],
          login: [authenticate],
          createInvoiceItem: [authenticate]
        };
      }

      createInvoiceItem = async (req: Request, res: Response): Promise<Response> => {
    try {
       const { invoiceItem, newEan, unMappedProductId } = req.body;


      const response = await this.service.createInvoiceItem(invoiceItem, newEan, unMappedProductId)

      return res.status(201).json(response);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new InvoiceItemsController();
