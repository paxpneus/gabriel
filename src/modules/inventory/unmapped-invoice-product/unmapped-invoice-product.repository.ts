import { Op, Transaction } from 'sequelize';
import BaseRepository from '../../../shared/utils/base-models/base-repository';
import { Invoice } from '../../warehouse';
import UnmappedInvoiceProduct from './unmapped-invoice-product.model';
import { UnmappedInvoiceProductAttributes } from './unmapped-invoice-product.types';

export class UnmappedInvoiceProductRepository extends BaseRepository<UnmappedInvoiceProduct> {
  constructor() {
    super(UnmappedInvoiceProduct);
  }

  async getFullById(id: string): Promise<UnmappedInvoiceProduct>{
    const unMapped = await this.findById(id, {
      include: [
        {
          model: Invoice,
          as: 'invoice',
          attributes: ['number_system', 'id']
        }
      ]
    })

    if (!unMapped) {
      throw new Error("Produto não mapeado não encontrado!")
    }

    return unMapped
  }

  // Pendentes (UNMAPPED) da integração, mais recentes primeiro, com o número da nota — relatório de pendências de integração.
  findPendingByIntegration(integrationsId: string): Promise<UnmappedInvoiceProduct[]> {
    return this.findAll({
      where: { integrations_id: integrationsId, status: 'UNMAPPED' },
      attributes: ['id', 'type', 'ean', 'sku', 'product_name', 'external_id', 'reason', 'quantity', 'invoice_id', 'image_path', 'createdAt'],
      include: [{ model: Invoice, as: 'invoice', attributes: ['number_system', 'id'] }],
      order: [['createdAt', 'DESC']],
    });
  }

  async findUnmappedByInvoiceIds(
    invoiceIds: string[],
    transaction?: Transaction,
  ): Promise<UnmappedInvoiceProduct[]> {
    if (!invoiceIds.length) return [];

    return this.findAll({
      where: {
        invoice_id: { [Op.in]: invoiceIds },
        status: 'UNMAPPED',
      },
      include: [
        {
          model: Invoice,
          as: 'invoice',
          attributes: ['number_system', 'id'],
        },
      ],
      transaction,
    });
  }

  async findByCodeExcluding(
    supplierProductCode: string,
    excludeId: string,
    transaction?: Transaction,
  ): Promise<UnmappedInvoiceProduct[]> {
    return this.findAll({
      where: {
        status: 'UNMAPPED',
        id: { [Op.ne]: excludeId },
        invoice_id: { [Op.ne]: null },
        [Op.or]: [{ ean: supplierProductCode }, { sku: supplierProductCode }],
      },
      include: [
        {
          model: Invoice,
          as: 'invoice',
          attributes: ['id', 'sender_cnpj'],
          required: true,
        },
      ],
      transaction,
    });
  }
}

export default new UnmappedInvoiceProductRepository();
