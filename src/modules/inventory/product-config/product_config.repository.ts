import { Op, Transaction, WhereAttributeHash } from 'sequelize';
import BaseRepository from '../../../shared/utils/base-models/base-repository';
import ProductConfig from './product_config.model';
import { ProductConfigAttributes } from './product_config.types';
import Product from '../products/product.model';
import UnitBusiness from '../../company/unit-business/unit-business.model';

export class ProductConfigRepository extends BaseRepository<ProductConfig> {
  constructor() {
    super(ProductConfig);
  }

  // ProductConfigs de OUTROS produtos com gtin em `codes` nas unit businesses da integração (join, sem listar lojas antes).
  findGtinOwnersInIntegration(
    codes: string[],
    integrationsId: string,
    excludeProductId: string | null,
    transaction?: Transaction,
  ): Promise<ProductConfig[]> {
    const where: WhereAttributeHash<ProductConfigAttributes> = { gtin: { [Op.in]: codes } };
    if (excludeProductId) where.product_id = { [Op.ne]: excludeProductId };

    return this.findAll({
      where,
      attributes: ['id', 'product_id', 'unit_business_id', 'gtin'],
      include: [
        {
          model: UnitBusiness,
          as: 'unitBusiness',
          attributes: ['id', 'name', 'number'],
          where: { integrations_id: integrationsId },
          required: true,
        },
        { model: Product, as: 'product', attributes: ['id', 'name'] },
      ],
      transaction,
    });
  }

  // Configurações com EAN do ERP (gtin_erp) nas lojas da integração — base do relatório de pendências de integração.
  findErpEansInIntegration(integrationsId: string): Promise<ProductConfig[]> {
    return this.findAll({
      where: { gtin_erp: { [Op.ne]: null } },
      attributes: ['product_id', 'unit_business_id', 'gtin_erp'],
      include: [
        {
          model: UnitBusiness,
          as: 'unitBusiness',
          attributes: ['name'],
          where: { integrations_id: integrationsId },
          required: true,
        },
        { model: Product, as: 'product', attributes: ['id', 'name'] },
      ],
    });
  }

  // Configurações SEM EAN do ERP (gtin_erp nulo) nas lojas da integração — seção "produto sem EAN" do relatório.
  findMissingErpEanInIntegration(integrationsId: string): Promise<ProductConfig[]> {
    return this.findAll({
      where: { gtin_erp: { [Op.is]: null } },
      attributes: ['product_id', 'unit_business_id'],
      include: [
        {
          model: UnitBusiness,
          as: 'unitBusiness',
          attributes: ['name'],
          where: { integrations_id: integrationsId },
          required: true,
        },
        { model: Product, as: 'product', attributes: ['id', 'name'] },
      ],
      order: [[{ model: Product, as: 'product' }, 'name', 'ASC']],
    });
  }
}

export default new ProductConfigRepository();
