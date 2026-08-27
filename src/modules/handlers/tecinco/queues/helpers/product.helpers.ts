import { Op, Transaction } from "sequelize";
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

  // 3. Product.ean / Product.ean_tribut diretamente
  // (evita tentar INSERT num ean que já existe em outro produto, o que
  // estoura o índice único parcial products_ean_unique e vira um erro
  // genérico "Validation error" na fila, já que o conflictFields do
  // upsert olha só id_system)
  if (ean) {
    product = await Product.findOne({
      where: { [Op.or]: [{ ean }, { ean_tribut: ean }] },
    });
    if (product) {
      console.log(
        `${logPrefix} — produto resolvido via Product.ean/ean_tribut (ean=${ean}): id=${product.id}`,
      );
      return product;
    }
  }

  // 4. SupplierMapping pelo EAN
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

  // 5. SupplierMapping pelo codigoFabrica
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

// Regra: sempre que um produto é resolvido (não importa por qual caminho —
// integration mapping, id_system, ProductConfig.sku, SupplierMapping...) e
// ele tem EAN, esse EAN precisa estar registrado como SupplierMapping. Se o
// EAN já corresponde a algum produto ou supplier mapping existente, não faz
// nada; senão, cria o vínculo.
async function backfillSupplierMappingByEan(params: {
  product: typeof Product.prototype;
  ean?: string;
  logPrefix: string;
}): Promise<void> {
  const { product, ean, logPrefix } = params;
  if (!ean) return;

  const existingByEan = await resolveProductByEan({ ean, logPrefix });
  if (existingByEan) return;

  await SupplierMapping.create({
    product_id: product.id,
    supplier_product_code: ean,
  });
  console.log(
    `${logPrefix} — EAN=${ean} não correspondia a nenhum produto/supplier mapping — SupplierMapping criado vinculando ao produto id=${product.id}`,
  );
}

export async function resolveProductWithMapping(params: {
  integrationsId: string;
  systemId: string;
  codigoFabrica?: string;
  ean?: string;
  logPrefix: string;
}): Promise<typeof Product.prototype | null> {
  const { integrationsId, systemId, codigoFabrica, ean, logPrefix } =
    params;

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

    const resolved = mappedProduct as typeof Product.prototype;
    await backfillSupplierMappingByEan({ product: resolved, ean, logPrefix });

    return resolved;
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

    await backfillSupplierMappingByEan({ product, ean, logPrefix });
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

export async function resolveProductByEan(params: {
  ean: string;
  logPrefix: string;
}): Promise<typeof Product.prototype | null> {
  const { ean, logPrefix } = params;

  const normalizedEan = normalizeEan(ean);
  if (!normalizedEan) return null;

  let product = await Product.findOne({
    where: {
      [Op.or]: [{ ean: normalizedEan }, { ean_tribut: normalizedEan }],
    },
  });
  if (product) {
    console.log(
      `${logPrefix} — produto resolvido via Product.ean/ean_tribut (ean=${normalizedEan})`,
    );
    return product;
  }

  const mapping = await SupplierMapping.findOne({
    where: { supplier_product_code: normalizedEan },
  });
  if (mapping) {
    product = await Product.findByPk(mapping.product_id);
    if (product) {
      console.log(
        `${logPrefix} — produto resolvido via SupplierMapping EAN=${normalizedEan}: id=${product.id}`,
      );
      return product;
    }
  }

  return null;
}

export async function resolveProductByEanWithStock(params: {
  ean: string;
  unitBusinessId: string;
  transaction?: Transaction;
  logPrefix: string;
}): Promise<typeof Product.prototype | null> {
  const { ean, unitBusinessId, transaction, logPrefix } = params;

  const normalizedEan = normalizeEan(ean);
  if (!normalizedEan) return null;

  const includeWithStock = [
    {
      model: Stock,
      as: "stocks",
      where: { unit_business_id: unitBusinessId },
    },
    {
      model: ProductConfig,
      as: "productConfigs",
      required: false,
      where: { unit_business_id: unitBusinessId },
    },
  ];

  let product = await Product.findOne({
    where: {
      [Op.or]: [{ ean: normalizedEan }, { ean_tribut: normalizedEan }],
    },
    include: includeWithStock,
    transaction,
  });
  if (product) {
    console.log(
      `${logPrefix} — produto resolvido via Product.ean/ean_tribut (ean=${normalizedEan})`,
    );
    return product;
  }

  // 2. fallback: SupplierMapping pelo EAN, também exigindo estoque na loja
  const mapping = await SupplierMapping.findOne({
    where: { supplier_product_code: normalizedEan },
    transaction,
  });
  if (mapping) {
    product = await Product.findOne({
      where: { id: mapping.product_id },
      include: includeWithStock,
      transaction,
    });
    if (product) {
      console.log(
        `${logPrefix} — produto resolvido via SupplierMapping EAN=${normalizedEan}: id=${product.id}`,
      );
      return product;
    }
  }

  return null;
}



