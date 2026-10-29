import { authenticate } from '../../../../../middlewares/auth-token';
import { userPermissions } from '../../../../../middlewares/user-permissions';
import BaseController from '../../../../../shared/utils/base-models/base-controller';
import InvoiceItems from './invoice-items.model';
import InvoiceItemsService from './invoice-items.service';
import { Request, Response } from "express";
import { SupplierMappingError } from '../../../../inventory/supplier-mapping/supplier-mapping.types';
import supplierMappingService from '../../../../inventory/supplier-mapping/supplier-mapping.service';

export class InvoiceItemsController extends BaseController<InvoiceItems, typeof InvoiceItemsService> {
  constructor() {
    super(InvoiceItemsService);

    this.router.post("/add/item", ...this.mw("createInvoiceItem"), this.createInvoiceItem)
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
          // userPermissions resolve a entidade invoice_product_mapping pela rota (CUSTOM_ROUTE_MAP "invoice-items/add/item").
          createInvoiceItem: [authenticate, userPermissions],
          // Ações do CRUD genérico sem chave aqui ficavam sem middleware nenhum.
          bulkCreate: [authenticate],
          bulkUpdate: [authenticate],
          bulkDestroy: [authenticate],
        };
      }

      createInvoiceItem = async (req: Request, res: Response): Promise<Response> => {
    try {
       const { invoiceItem, newEan, unMappedProductId } = req.body ?? {};
      // Sem o item/produto/não mapeado o service quebraria com erro técnico ("reading 'product_id'").
      if (!invoiceItem?.product_id || !unMappedProductId) {
        return res.status(400).json({ error: 'Informe o produto escolhido e o produto não mapeado' });
      }

      const response = await this.service.createInvoiceItemForUnmappedProducts(invoiceItem, newEan, unMappedProductId)

      return res.status(201).json(response);
    } catch (error: any) {
      // EAN de outro produto / EAN físico confirmado: vai com code pro front decidir (foto ou "Confirmar EAN físico").
      if (error instanceof SupplierMappingError) {
        return res.status(400).json(await supplierMappingService.buildErrorResponse(error, req.cookies?.token));
      }
      return res.status(400).json({ error: this.getErrorMessage(error) });
    }
  };
}

export default new InvoiceItemsController();
