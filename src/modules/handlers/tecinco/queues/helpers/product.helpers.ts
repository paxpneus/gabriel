import { Op } from "sequelize";
import {
  ProductConfig,
  Product,
  SupplierMapping,
  Stock,
} from "../../../../inventory";
import integrationMappingService from "../../../../integrations/integration-mapping/integration-mapping.service";

export function normalizeEan(ean?: string): string | undefined {
  if (!ean || ean.trim() === "" || ean.trim().toUpperCase() === "SEM GTIN")
    return undefined;
  return ean.trim();
}

export async function resolveProduct(params: {
  systemId: string;
  codigoFabrica?: string;
  ean?: string;
  logPrefix: string;
}): Promise<typeof Product.prototype | null> {
  const { systemId, codigoFabrica, ean, logPrefix } = params;

  // 1. id_system
  let product = await Product.findOne({ where: { id_system: systemId } });
  if (product) return product;

  // 2. ProductConfig.sku = codigoFabrica
  if (codigoFabrica) {
    const config = await ProductConfig.findOne({
      where: {
        sku: {
          [Op.in]: [codigoFabrica, systemId],
        },
      },
    });
    if (config) {
      product = await Product.findByPk(config.product_id);
      if (product) {
        console.log(
          `${logPrefix} — produto resolvido via ProductConfig.sku (codigoFabrica=${codigoFabrica}): id=${product.id}`,
        );
        return product;
      }
    }
  }

  // 3. SupplierMapping pelo EAN
  if (ean) {
    const mapping = await SupplierMapping.findOne({
      where: { supplier_product_code: ean },
    });
    if (mapping) {
      product = await Product.findByPk(mapping.product_id);
      if (product) {
        console.log(
          `${logPrefix} — produto resolvido via SupplierMapping EAN=${ean}: id=${product.id}`,
        );
        return product;
      }
    }
  }

  // 4. SupplierMapping pelo codigoFabrica
  if (codigoFabrica) {
    const mapping = await SupplierMapping.findOne({
      where: { supplier_product_code: codigoFabrica },
    });
    if (mapping) {
      product = await Product.findByPk(mapping.product_id);
      if (product) {
        console.log(
          `${logPrefix} — produto resolvido via SupplierMapping codigoFabrica=${codigoFabrica}: id=${product.id}`,
        );
        return product;
      }
    }
  }

  return null;
}

export async function resolveProductWithMapping(params: {
  integrationsId: string;
  systemId: string;
  codigoFabrica?: string;
  ean?: string;
  logPrefix: string;
}): Promise<typeof Product.prototype | null> {
  const { integrationsId, systemId, codigoFabrica, ean, logPrefix } = params;

  // 1) tenta achar direto pelo integration mapping (fast path)
  const mappedProduct = await integrationMappingService.findEntityByMapping(
    "PRODUCT",
    integrationsId,
    systemId,
  );

  if (mappedProduct) {
    console.log(
      `${logPrefix} — produto resolvido via integration mapping (external_id=${systemId})`,
    );
    return mappedProduct as typeof Product.prototype;
  }

  // 2) fallback: Busca detalhada dentro do sistema
  const product = await resolveProduct({ systemId, codigoFabrica, ean, logPrefix });

  // 3) achou pelo fallback? garante o mapping pra próxima vez não precisar dele
  if (product) {
    await integrationMappingService.createOrUpdateIntegrationMapping({
      entity_type: "PRODUCT",
      internal_id: product.id,
      external_id: systemId,
      integrations_id: integrationsId,
    });
    console.log(
      `${logPrefix} — integration mapping criado/atualizado (external_id=${systemId})`,
    );
  }

  return product;
}

export async function ensureSupplierMappings(params: {
  productId: string;
  supplierCnpj: string;
  ean?: string;
  codigoFabrica?: string;
  logPrefix: string;
  systemId?: string;
}): Promise<void> {
  const { productId, supplierCnpj, ean, codigoFabrica, logPrefix, systemId } = params;

  const mappingsToEnsure: Array<{ code: string; label: string }> = [];
  if (ean) mappingsToEnsure.push({ code: ean, label: "EAN" });
  if (codigoFabrica)
    mappingsToEnsure.push({ code: codigoFabrica, label: "codigoFabrica" });
  if (systemId) mappingsToEnsure.push({code: systemId, label: "systemId"})

  for (const { code, label } of mappingsToEnsure) {
    const existing = await SupplierMapping.findOne({
      where: { supplier_product_code: code },
    });
    if (!existing) {
      if (code) {
      await SupplierMapping.create({
        product_id: productId,
        supplier_cnpj: supplierCnpj,
        supplier_product_code: code,
      });
      }
      console.log(`${logPrefix} — SupplierMapping criado: ${label}=${code}`);
    }
  }
}


