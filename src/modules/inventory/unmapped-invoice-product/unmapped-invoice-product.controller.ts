import { authenticate } from '../../../middlewares/auth-token';
import BaseController from '../../../shared/utils/base-models/base-controller';
import UnmappedInvoiceProduct from './unmapped-invoice-product.model';
import UnmappedInvoiceProductService from './unmapped-invoice-product.service';
import { Request, Response } from 'express';
import { UnmappedInvoiceProductCreationAttributes } from './unmapped-invoice-product.types';

export class UnmappedInvoiceProductController extends BaseController<UnmappedInvoiceProduct, typeof UnmappedInvoiceProductService> {
  constructor() {
    super(UnmappedInvoiceProductService);

    this.router.post("/mark-updated/update", this.markMapped)
    this.router.post("/from-ean/create", this.createUnmappedFromReadingEan)
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
        };
      }

      markMapped = async (req: Request, res: Response): Promise<Response> => {
    try {
      const {ids} = req.body
      console.log(ids)
      

      await this.service.markMapped(ids as string[])

    return res.status(201).json({ message: "Produtos marcados como mapeados com sucesso!" });
    } catch (error: any) {
      return res.status(400).json({error: error.message})
    }
  }

   createUnmappedFromReadingEan = async (req: Request, res: Response): Promise<Response> => {
    try {
      const {createUnmappedDto, image} = req.body
      

      await this.service.createUnmappedFromReadingEan(createUnmappedDto as UnmappedInvoiceProductCreationAttributes, image)

    return res.status(201).json({ message: "Produto não mapeado registrado com sucesso!" });
    } catch (error: any) {
      return res.status(400).json({error: error.message})
    }
  }
}

export default new UnmappedInvoiceProductController();
