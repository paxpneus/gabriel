import BaseRepository from "../../../../../shared/utils/base-models/base-repository";
import Contact from "../../contacts.model";

// CRUD genérico de contatos; queries de vendedor/gerente ficam no domínio sellers/.
export class ContactRepository extends BaseRepository<Contact> {
  constructor() {
    super(Contact);
  }
}

export default new ContactRepository();
