import { authenticate } from "../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../middlewares/user-permissions";
import BaseController from "../../../../../shared/utils/base-models/base-controller";
import InvoiceOperation from "./invoice-operation.model";
import invoiceOperationService, { InvoiceOperationService } from "./invoice-operation.service";

// GET /api/invoice-operation pro filtro do front; permissão de Notas (CUSTOM_ROUTE_MAP "/api/invoice-operation").
export class InvoiceOperationController extends BaseController<InvoiceOperation, InvoiceOperationService> {
  constructor() {
    super(invoiceOperationService);
  }

  // Leitura só com login; escrita exige permissão (tabela é seed, sem tela de cadastro).
  protected middlewaresFor() {
    return {
      index: [authenticate],
      show: [authenticate],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }
}

export default new InvoiceOperationController();
