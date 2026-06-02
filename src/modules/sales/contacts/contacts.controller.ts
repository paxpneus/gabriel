import BaseController from "../../../shared/utils/base-models/base-controller";
import Contact from "./contacts.model";
import contactService, { ContactService } from "./contacts.service";

class ContactController extends BaseController<Contact, ContactService> {
  constructor() {
    super(contactService);
  }
}

export default new ContactController();
