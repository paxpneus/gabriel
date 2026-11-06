import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import productRepository from "../../../inventory/products/repository/product.repository";
// Fachada do core (não a de contacts): a da entidade puxa sellers → integration-mapping.service e fecha ciclo com este mapa.
import { contactRepository as contactsRepository } from "../../../sales/contacts/core";
import invoiceRepository from "../../../warehouse/fiscal/invoices/invoice/invoice.repository";
import paymentMethodRepository from "../../../sales/orders/payment_method/payment_method.repository";
import { EntityType } from "../integration-mapping.types";

export const entityRepositoryMap: Record<EntityType, BaseRepository<any>> = {
  PRODUCT: productRepository,   
  INVOICE: invoiceRepository, 
  CONTACT: contactsRepository,   
  PAYMENT_METHOD: paymentMethodRepository,
};