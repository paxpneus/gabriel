import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";
import BaseController, { StoreNumberField } from "../../../shared/utils/base-models/base-controller";
import Contact from "./contacts.model";
import contactService, { ContactService } from "./contacts.service";
import { Request, Response } from "express";
import { validateCreate } from "../../../middlewares/validation";
import { CreateContactWithUserSchema } from "./schemas/contact.schema";
import affiliatedController from "./affiliated/affiliated.controller";

class ContactController extends BaseController<Contact, ContactService> {
  constructor() {
    super(contactService);

    this.router.post(`/create-from-seller-name`, ...this.mw("createUserFromSellerName"), this.createUserFromSellerName)

    this.router.post(`/with-user`, ...this.mw("createWithUser"), this.createWithUser)

    // Affiliated login/me live under contacts: /api/contacts/affiliated/{login,me} (/:id only matches one segment).
    this.router.use(`/affiliated`, affiliatedController.router)
  }

   // ?store_number= de application filtra o index por unit_business_id.
   protected storeNumberField(): StoreNumberField {
     return "unit_business_id";
   }

   protected middlewaresFor() {
      return {
        index: [authenticate, userPermissions],
        create: [authenticate, userPermissions],
        update: [
          authenticate,
          userPermissions
        ],
        show: [authenticate, userPermissions],
        destroy: [authenticate, userPermissions],
        // CRUD bulk do BaseController: sem chave aqui a rota ficava sem nenhum middleware.
        bulkCreate: [authenticate, userPermissions],
        bulkUpdate: [authenticate, userPermissions],
        bulkDestroy: [authenticate, userPermissions],
        createWithUser: [authenticate, validateCreate(CreateContactWithUserSchema), userPermissions],
      };
    }

    createUserFromSellerName = async (req: Request, res: Response): Promise<Response> => {
      try {
        const {name, unitBusinessNumber, email, password} = req.body
      const record = await this.service.createUserFromSellerName(name, unitBusinessNumber, email, password);
      return res.status(201).json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
    }

    // Creates User + Contact for a contact type with login (affiliated, seller).
    createWithUser = async (req: Request, res: Response): Promise<Response> => {
      try {
        const record = await this.service.createWithUser(req.body);
        return res.status(201).json(record);
      } catch (error: any) {
        return res.status(400).json({ error: error.message });
      }
    }
}

export default new ContactController();
