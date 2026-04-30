import { FullInvoice } from './invoice.types';
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import UnmappedInvoiceProduct from "../../../inventory/unmapped-invoice-product/unmapped-invoice-product.model";
import { InvoiceFull } from "../../expedition/batch/batch.types";
import InvoiceItems from "../invoice-items/invoice-items.model";
import Invoice from "./invoice.model";
import { Product } from '../../../inventory';

export class InvoiceRepository extends BaseRepository<Invoice> {
  constructor() {
    super(Invoice);
  }

  async getFullInvoice(invoiceId: string): Promise<FullInvoice> {
    const data = await this.findById(invoiceId, {
      include: [
        {
          model: InvoiceItems,
          as: "items",
          include: [
          {
            model: Product,
            as: 'product'
          }
          ]
        },
        {
          model: UnmappedInvoiceProduct,
          as: 'unmappedProducts'
        }
      ],
    });

    if (!data) {
      throw new Error(`Nota não encontrado`);
    }

    return data.get({ plain: true }) as FullInvoice;
  }
}

export default new InvoiceRepository();
