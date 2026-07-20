import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import productRepository from "../../../inventory/products/product.repository";
import contactsRepository from "../../../sales/contacts/contacts.repository";
import invoiceRepository from "../../../warehouse/invoices/invoice/invoice.repository";
import { EntityType } from "../integration-mapping.types";

export const entityRepositoryMap: Record<EntityType, BaseRepository<any>> = {
  PRODUCT: productRepository,   
  INVOICE: invoiceRepository, 
  CONTACT: contactsRepository,   
};