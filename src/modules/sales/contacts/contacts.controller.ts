import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";
import BaseController, { StoreNumberField } from "../../../shared/utils/base-models/base-controller";
import Contact from "./contacts.model";
import contactService, { ContactService } from "./contacts.service";
import { Request, Response } from "express";

class ContactController extends BaseController<Contact, ContactService> {
  constructor() {
    super(contactService);

    this.router.post(`/create-from-seller-name`, ...this.mw("createUserFromSellerName"), this.createUserFromSellerName)
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
}

export default new ContactController();
