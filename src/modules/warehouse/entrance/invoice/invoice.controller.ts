import { LabelService } from './invoice-label.service';
import BaseController from '../../../../shared/utils/base-models/base-controller';
import Invoice from './invoice.model';
import InvoiceService from './invoice.service';
import { Request, Response } from 'express';

export class InvoiceController extends BaseController<Invoice, typeof InvoiceService> {

  private labelService: LabelService

  constructor() {
    super(InvoiceService);

    this.labelService = new LabelService()

    this.router.get('/labels/data', this.getLabelData)
  }

  getLabelData = async (req: Request, res: Response): Promise<Response> => {
    try {
    let ids: string[] = [];
 
    if (Array.isArray(req.query.invoiceIds)) {
      ids = req.query.invoiceIds as string[];
    } else if (typeof req.query.invoiceIds === 'string') {
      ids = req.query.invoiceIds.split(',').map((s) => s.trim()).filter(Boolean);
    }

    const data = await this.labelService.getLabelData(ids)

    return res.json({data})
  } catch (err: any) {
      return res.status(500).json({ error: err.message })
    }
  }
}

export default new InvoiceController();
