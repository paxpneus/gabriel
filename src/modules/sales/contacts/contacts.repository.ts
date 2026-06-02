import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Contact from "./contacts.model";

export class ContactRepository extends BaseRepository<Contact> {
  constructor() {
    super(Contact);
  }
}

export default new ContactRepository();
