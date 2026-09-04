import { CreateOptions, UniqueConstraintError } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import SupplierMapping from "./supplier-mapping.model";
import supplierMappingRepository, {
  SupplierMappingRepository,
} from "./supplier-mapping.repository";
import {
  FullSupplierMapping,
  SupplierMappingCreationAttributes,
} from "./supplier-mapping.types";
import { resolveIntegrationsIdForUnitBusiness } from "../../handlers/tecinco/queues/helpers/product.helpers";
import sequelize from "../../../config/sequelize";
import unmappedInvoiceProductService from "../unmapped-invoice-product/unmapped-invoice-product.service";
import integrationMappingService from "../../integrations/integration-mapping/integration-mapping.service";

export class SupplierMappingService extends BaseService<
  SupplierMapping,
  SupplierMappingRepository
> {
  constructor() {
    super(supplierMappingRepository);
  }

  async findByProductCode(
    ean: string,
    unitBusinessId: string,
  ): Promise<FullSupplierMapping | null> {
    if (!ean) {
      throw Error("EAN Não informado");
    }

    const integrationsId = await resolveIntegrationsIdForUnitBusiness(unitBusinessId);

    const supplierFound = await this.repository.findSupplierByProductCode(
      ean,
      integrationsId,
    );

    if (!supplierFound) return null;

    return supplierFound;
  }

  async create(
    data: Partial<SupplierMappingCreationAttributes>,
    options?: CreateOptions,
  ): Promise<SupplierMapping> {
    const productCode = data.supplier_product_code;

    if (!productCode) {
      throw new Error("supplier_product_code não informado");
    }

    if (!data.integrations_id) {
      throw new Error("integrations_id não informado");
    }

    // Conflito (código já é gtin de outro produto na mesma integração, ou
    // já existe SupplierMapping com esse código nela) é validado pelo
    // próprio banco — unique index
    // product_supplier_maps_integrations_id_code_unique e o trigger
    // trigger_prevent_supplier_mapping_gtin_conflict — não precisa duplicar
    // a checagem aqui.
    try {
      return await this.repository.create(data, options);
    } catch (error: any) {
      if (error instanceof UniqueConstraintError) {
        throw new Error(
          `Já existe um SupplierMapping com o código ${productCode} nessa integração`,
        );
      }
      throw error;
    }
  }

  // Mapeia manualmente um unmapped pra um product_id JÁ EXISTENTE via
  // SupplierMapping (sem passar por invoice/InvoiceItems) — útil sobretudo
  // pro unmapped de catálogo (invoice_id: null, sem nota associada), onde
  // createInvoiceItemForUnmappedProducts não se aplica. Cria o
  // SupplierMapping com o código de fornecedor do próprio unmapped
  // (ean, com fallback pra sku) e apaga o unmapped em seguida, na mesma
  // transação.
  async createFromUnmapped(params: {
    productId: string;
    unmappedInvoiceProductId: string;
    supplierCnpj?: string;
  }): Promise<SupplierMapping> {
    return sequelize.transaction(async (t) => {
      const unmapped = await unmappedInvoiceProductService.findById(
        params.unmappedInvoiceProductId,
        { transaction: t },
      );

      if (!unmapped) {
        throw new Error("Produto não mapeado não encontrado!");
      }

      const supplierProductCode = unmapped.ean ?? unmapped.sku;
      if (!supplierProductCode) {
        throw new Error(
          "Produto não mapeado sem EAN/SKU, não é possível criar o DE X PARA",
        );
      }

      if (!unmapped.integrations_id) {
        throw new Error(
          "Produto não mapeado sem integração associada, não é possível criar o DE X PARA",
        );
      }

      // Se já existe um SupplierMapping com esse código nessa integração
      // apontando pro MESMO produto, é idempotente — não é erro, só não
      // recria (senão estouraria a unique constraint à toa). Só é conflito
      // de verdade quando o código já está mapeado pra um produto
      // DIFERENTE do que está sendo enviado agora.
      const existingMapping = await this.findOne({
        where: {
          integrations_id: unmapped.integrations_id,
          supplier_product_code: supplierProductCode,
        },
        transaction: t,
      });

      let supplierMapping: SupplierMapping;
      if (existingMapping) {
        if (existingMapping.product_id !== params.productId) {
          throw new Error(
            `Já existe um SupplierMapping com o código ${supplierProductCode} nessa integração, mapeado para outro produto (id=${existingMapping.product_id})`,
          );
        }
        supplierMapping = existingMapping;
      } else {
        supplierMapping = await this.create(
          {
            product_id: params.productId,
            supplier_cnpj: params.supplierCnpj,
            supplier_product_code: supplierProductCode,
            integrations_id: unmapped.integrations_id,
          },
          { transaction: t },
        );
      }

      // unmapped de catálogo (invoice_id: null) tem external_id = id real do
      // produto no ERP — se ele existir, aproveita que já temos o par
      // externo/interno aqui e garante o IntegrationMapping também. Sem
      // isso, o próximo sync de catálogo não acharia mapping pra esse
      // external_id (resolveProductWithMapping é mapping-only) e recriaria
      // um unmapped pro mesmo produto, desfazendo esse mapeamento manual.
      // createOrUpdateIntegrationMapping já é idempotente — não sobrescreve
      // se já existir outro mapping pra esse external_id/internal_id.
      if (unmapped.external_id) {
        await integrationMappingService.createOrUpdateIntegrationMapping(
          {
            entity_type: "PRODUCT",
            internal_id: params.productId,
            integrations_id: unmapped.integrations_id,
            external_id: unmapped.external_id,
          },
          t,
        );
      }

      await unmappedInvoiceProductService.delete(unmapped.id, {
        transaction: t,
      });

      return supplierMapping;
    });
  }
}

export default new SupplierMappingService();
