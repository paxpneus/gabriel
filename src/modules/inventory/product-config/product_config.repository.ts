import { Op, Transaction } from 'sequelize';
import BaseRepository from '../../../shared/utils/base-models/base-repository';
import ProductConfig from './product_config.model';
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
    return this.findAll({
      where: {
        gtin: { [Op.in]: codes },
        ...(excludeProductId ? { product_id: { [Op.ne]: excludeProductId } } : {}),
      },
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
}

export default new ProductConfigRepository();
