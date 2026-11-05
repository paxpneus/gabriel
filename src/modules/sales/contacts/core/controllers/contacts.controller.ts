import { RequestHandler } from "express";
import { authenticate } from "../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../middlewares/user-permissions";
import BaseController, { StoreNumberField } from "../../../../../shared/utils/base-models/base-controller";
import Contact from "../../contacts.model";
import contactService, { ContactService } from "../services/contacts.service";

// custom_data só pelas rotas próprias que validam (ex.: PUT /:id/manager-periods): o CRUD genérico descarta o campo.
const dropCustomData: RequestHandler = (req, _res, next) => {
  const bodies = Array.isArray(req.body) ? req.body : [req.body];
  bodies.forEach((body) => {
    if (body && typeof body === "object") delete body.custom_data;
  });
  next();
};

// CRUD genérico de /api/contacts; rotas de vendedor/gerente ficam no domínio sellers/.
class ContactController extends BaseController<Contact, ContactService> {
  constructor() {
    super(contactService);
  }

   // ?store_number= de application filtra o index por unit_business_id.
   protected storeNumberField(): StoreNumberField {
     return "unit_business_id";
   }

   protected middlewaresFor() {
      return {
        index: [authenticate, userPermissions],
        create: [authenticate, userPermissions, dropCustomData],
        update: [
          authenticate,
          userPermissions,
          dropCustomData,
        ],
        // GET /:id é respondido pelo sellers.controller (montado antes), com nome da loja/grupo nos períodos do gerente.
        show: [authenticate, userPermissions],
        destroy: [authenticate, userPermissions],
        // CRUD bulk do BaseController: sem chave aqui a rota ficava sem nenhum middleware.
        bulkCreate: [authenticate, userPermissions, dropCustomData],
        bulkUpdate: [authenticate, userPermissions, dropCustomData],
        bulkDestroy: [authenticate, userPermissions],

      };
    }
}

export default new ContactController();
