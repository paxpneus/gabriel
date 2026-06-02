import BaseService from "../../../shared/utils/base-models/base-service";
import Contact from "./contacts.model";
import contactRepository, { ContactRepository } from "./contacts.repository";

export class ContactService extends BaseService<Contact, ContactRepository> {
  constructor() {
    super(contactRepository);
  }
}

export default new ContactService();
