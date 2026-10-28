import { Transaction } from 'sequelize';
import BaseService from '../../../shared/utils/base-models/base-service';
import ProductConfig from './product_config.model';
import productConfigRepository, { ProductConfigRepository } from './product_config.repository';

export class ProductConfigService extends BaseService<ProductConfig, ProductConfigRepository> {
  constructor() {
    super(productConfigRepository);
  }

  // Configs de outros produtos que usam algum dos códigos como gtin dentro da integração (ver repository).
  findGtinOwnersInIntegration(
    codes: string[],
    integrationsId: string,
    excludeProductId: string | null,
    transaction?: Transaction,
  ): Promise<ProductConfig[]> {
    return this.repository.findGtinOwnersInIntegration(codes, integrationsId, excludeProductId, transaction);
  }

}

export default new ProductConfigService();
