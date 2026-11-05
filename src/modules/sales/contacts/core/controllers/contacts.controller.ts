import { Request, RequestHandler, Response } from "express";
import { Op } from "sequelize";
import { authenticate } from "../../../../../middlewares/auth-token";
import { userPermissions } from "../../../../../middlewares/user-permissions";
import BaseController, { StoreNumberField } from "../../../../../shared/utils/base-models/base-controller";
import Contact from "../../contacts.model";
import contactService, { ContactService } from "../services/contacts.service";
import { ContactInUseError } from "../helpers/errors";

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

   // Destroy/bulkDestroy do BaseController com 409 quando o contato está em uso (período, pedido ou nota); resto igual.
   destroy = async (req: Request, res: Response): Promise<Response> => {
     try {
       const deleted = await this.service.delete(req.params.id as string);
       if (!deleted) return res.status(404).json({ error: "Não encontrado" });
       return res.status(204).send();
     } catch (error: any) {
       if (error instanceof ContactInUseError) return res.status(409).json({ error: error.message });
       return res.status(500).json({ error: error.message });
     }
   };

   bulkDestroy = async (req: Request, res: Response): Promise<Response> => {
     try {
       const { ids } = req.body as { ids: string[] };
       if (!Array.isArray(ids) || ids.length === 0) {
         return res.status(400).json({ error: "Informe um array de ids válido." });
       }
       const deleted = await this.service.bulkDelete({ where: { id: { [Op.in]: ids } } });
       return res.json({ deleted });
     } catch (error: any) {
       if (error instanceof ContactInUseError) return res.status(409).json({ error: error.message });
       return res.status(500).json({ error: error.message });
     }
   };

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
