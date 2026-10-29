import { Transaction } from 'sequelize';
import BaseService from '../../../shared/utils/base-models/base-service';
import ProductConfig from './product_config.model';
import productConfigRepository, { ProductConfigRepository } from './product_config.repository';
import {
  findAnotherProductUsingEan,
  resolveIntegrationsIdForUnitBusiness,
} from '../../handlers/tecinco/queues/helpers/product.helpers';

export class ProductConfigService extends BaseService<ProductConfig, ProductConfigRepository> {
  constructor() {
    super(productConfigRepository);
  }

  // EAN gravado à mão numa configuração (CRUD genérico) tem as mesmas regras dos fluxos novos: não pode ser gtin/DE x
  // PARA (com zero à esquerda, inclusive EAN físico confirmado) de outro produto na integração da loja.
  async assertGtinFreeForProduct(gtin: unknown, productId: string, unitBusinessId: string): Promise<void> {
    if (gtin === null || gtin === undefined || gtin === '') return;
    const integrationsId = await resolveIntegrationsIdForUnitBusiness(unitBusinessId);
    const ownerId = await findAnotherProductUsingEan(String(gtin), productId, integrationsId);
    if (ownerId) {
      throw new Error(
        `O EAN ${gtin} já é usado por outro produto nessa integração. Use "Confirmar EAN físico" para trocar o dono. [produto ${ownerId}]`,
      );
    }
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
