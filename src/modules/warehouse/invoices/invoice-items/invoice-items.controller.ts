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

  private getErrorMessage(error: any): string {
    if (error?.name === "SequelizeUniqueConstraintError") {
      const constraint = error?.parent?.constraint ?? error?.constraint;

      if (constraint === "uq_invoice_items_invoice_product") {
        return "Esse produto já está vinculado a esta nota.";
      }

      if (constraint === "product_supplier_maps_product_id_supplier_product_code_unique") {

        return "Esse produto já possui mapeamento para este fornecedor.";
      }

      return "Já existe um registro com esses dados.";
    }

    if (error?.name === "SequelizeValidationError" && error?.errors?.length) {
      return error.errors.map((item: any) => item.message).join(", ");
    }

    return error?.message ?? "Erro ao processar a solicitação.";
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
      return res.status(400).json({ error: this.getErrorMessage(error) });
    }
  };
}

export default new InvoiceItemsController();
