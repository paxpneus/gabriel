import { Op, Transaction } from "sequelize";
import {
  ProductConfig,
  Product,
  SupplierMapping,
  Stock,
} from "../../../../inventory";
import UnitBusiness from "../../../../company/unit-business/unit-business.model";
import integrationMappingService from "../../../../integrations/integration-mapping/integration-mapping.service";

export function normalizeEan(ean?: string): string | undefined {
  if (!ean) return undefined;
  const trimmed = ean.trim();
  if (!trimmed) return undefined;
  // A Tecinco manda variações de "sem código de barras" (com ou sem espaço,
  // ex.: "SEM GTIN", "SEMGTIN") — sem normalizar espaço, isso vaza como se
  // fosse um EAN de verdade e cruza produtos completamente diferentes que
  // não têm código de barras cadastrado (todos "iguais" pelo mesmo texto).
  if (trimmed.toUpperCase().replace(/\s+/g, "") === "SEMGTIN") return undefined;
  return trimmed;
}

// unit_business_id é sempre a fonte da verdade de "qual loja" — nunca dá pra
// inferir isso de longe. A partir dela derivamos a integrations_id (sistema
// como um todo: Bling ou Tecinco) só quando algo realmente precisa dela
// (integration_mappings, SupplierMapping — nenhum dos dois tem coluna de
// unit_business_id). ProductConfig, por outro lado, TEM unit_business_id e
// deve ser sempre consultado por ela diretamente — nunca por "qualquer loja
// dessa integração", já que uma integração pode ter várias lojas com
// ProductConfig.gtin populado de formas diferentes.
async function resolveIntegrationsIdForUnitBusiness(
  unitBusinessId: string,
  transaction?: Transaction,
): Promise<string> {
  const unitBusiness = await UnitBusiness.findByPk(unitBusinessId, {
    attributes: ["integrations_id"],
    transaction,
  });
  if (!unitBusiness?.integrations_id) {
    throw new Error(
      `UnitBusiness ${unitBusinessId} sem integrations_id configurado`,
    );
  }
  return unitBusiness.integrations_id;
}

export async function resolveProduct(params: {
  systemId: string;
  codigoFabrica?: string;
  ean?: string;
  unitBusinessId: string;
  logPrefix: string;
}): Promise<typeof Product.prototype | null> {
  const { systemId, codigoFabrica, ean, unitBusinessId, logPrefix } = params;

  // 1. id_system
  let product = await Product.findOne({ where: { id_system: systemId } });
  if (product) return product;

  // 2. ProductConfig.sku = codigoFabrica
  if (codigoFabrica) {
    const config = await ProductConfig.findOne({
      where: {
        unit_business_id: unitBusinessId,
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

  // 3. ProductConfig.gtin / gtin_package diretamente, na própria unit
  // business (evita tentar INSERT num gtin que já existe em outro produto
  // dessa loja, o que estoura a constraint única e vira um erro genérico
  // "Validation error" na fila, já que o conflictFields do upsert olha só
  // id_system)
  if (ean) {
    const config = await ProductConfig.findOne({
      where: {
        unit_business_id: unitBusinessId,
        [Op.or]: [{ gtin: ean }, { gtin_package: ean }],
      },
    });
    if (config) {
      product = await Product.findByPk(config.product_id);
      if (product) {
        console.log(
          `${logPrefix} — produto resolvido via ProductConfig.gtin/gtin_package (ean=${ean}): id=${product.id}`,
        );
        return product;
      }
    }
  }

  const integrationsId = await resolveIntegrationsIdForUnitBusiness(unitBusinessId);

  // 4. SupplierMapping pelo EAN
  if (ean) {
    const mapping = await SupplierMapping.findOne({
      where: { supplier_product_code: ean, integrations_id: integrationsId },
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
      where: { supplier_product_code: codigoFabrica, integrations_id: integrationsId },
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
// EAN já corresponde a algum produto ou supplier mapping existente NA MESMA
// INTEGRAÇÃO, não faz nada; senão, cria o vínculo.
async function backfillSupplierMappingByEan(params: {
  product: typeof Product.prototype;
  ean?: string;
  unitBusinessId: string;
  logPrefix: string;
}): Promise<void> {
  const { product, ean, unitBusinessId, logPrefix } = params;
  if (!ean) return;

  const existingByEan = await resolveProductByEan({ ean, unitBusinessId, logPrefix });
  if (existingByEan) return;

  const integrationsId = await resolveIntegrationsIdForUnitBusiness(unitBusinessId);

  await SupplierMapping.create({
    product_id: product.id,
    supplier_product_code: ean,
    integrations_id: integrationsId,
  });
  console.log(
    `${logPrefix} — EAN=${ean} não correspondia a nenhum produto/supplier mapping nessa integração — SupplierMapping criado vinculando ao produto id=${product.id}`,
  );
}

// Resolve produto SÓ por integration_mapping — sem fallback por id_system,
// ProductConfig.sku, EAN ou SupplierMapping. Esses fallbacks já causaram
// mappings errados/produtos duplicados no passado (ver contexto da sessão de
// matching Tecinco↔local); a partir de agora, se não tem mapping, não
// resolve — quem chama decide o que fazer (registrar em
// unmapped_invoice_products, não criar produto sozinho).
export async function resolveProductWithMapping(params: {
  unitBusinessId: string;
  systemId: string;
  ean?: string;
  logPrefix: string;
}): Promise<typeof Product.prototype | null> {
  const { unitBusinessId, systemId, ean, logPrefix } = params;

  const integrationsId = await resolveIntegrationsIdForUnitBusiness(unitBusinessId);

  const mappedProduct = await integrationMappingService.findEntityByMapping(
    "PRODUCT",
    integrationsId,
    systemId,
  );

  if (!mappedProduct) return null;

  console.log(
    `${logPrefix} — produto resolvido via integration mapping (external_id=${systemId})`,
  );

  const resolved = mappedProduct as typeof Product.prototype;
  await backfillSupplierMappingByEan({ product: resolved, ean, unitBusinessId, logPrefix });

  return resolved;
}

export async function ensureSupplierMappings(params: {
  productId: string;
  supplierCnpj: string;
  ean?: string;
  codigoFabrica?: string;
  unitBusinessId: string;
  logPrefix: string;
  systemId?: string;
}): Promise<void> {
  const { productId, supplierCnpj, ean, codigoFabrica, unitBusinessId, logPrefix, systemId } = params;

  const integrationsId = await resolveIntegrationsIdForUnitBusiness(unitBusinessId);

  const mappingsToEnsure: Array<{ code: string; label: string }> = [];
  if (ean) mappingsToEnsure.push({ code: ean, label: "EAN" });
  if (codigoFabrica)
    mappingsToEnsure.push({ code: codigoFabrica, label: "codigoFabrica" });
  if (systemId) mappingsToEnsure.push({code: systemId, label: "systemId"})

  for (const { code, label } of mappingsToEnsure) {
    const existing = await SupplierMapping.findOne({
      where: { supplier_product_code: code, integrations_id: integrationsId },
    });
    if (!existing) {
      if (code) {
      await SupplierMapping.create({
        product_id: productId,
        supplier_cnpj: supplierCnpj,
        supplier_product_code: code,
        integrations_id: integrationsId,
      });
      }
      console.log(`${logPrefix} — SupplierMapping criado: ${label}=${code}`);
    }
  }
}

export async function resolveProductByEan(params: {
  ean: string;
  unitBusinessId: string;
  logPrefix: string;
}): Promise<typeof Product.prototype | null> {
  const { ean, unitBusinessId, logPrefix } = params;

  const normalizedEan = normalizeEan(ean);
  if (!normalizedEan) return null;

  const config = await ProductConfig.findOne({
    where: {
      unit_business_id: unitBusinessId,
      [Op.or]: [{ gtin: normalizedEan }, { gtin_package: normalizedEan }],
    },
  });
  if (config) {
    const product = await Product.findByPk(config.product_id);
    if (product) {
      console.log(
        `${logPrefix} — produto resolvido via ProductConfig.gtin/gtin_package (ean=${normalizedEan})`,
      );
      return product;
    }
  }

  const integrationsId = await resolveIntegrationsIdForUnitBusiness(unitBusinessId);

  const mapping = await SupplierMapping.findOne({
    where: { supplier_product_code: normalizedEan, integrations_id: integrationsId },
  });
  if (mapping) {
    const product = await Product.findByPk(mapping.product_id);
    if (product) {
      console.log(
        `${logPrefix} — produto resolvido via SupplierMapping EAN=${normalizedEan}: id=${product.id}`,
      );
      return product;
    }
  }

  return null;
}

// Erro de dados (não é infra) — quem chama decide como reagir, mas por
// padrão não deve ser reprocessado com retry/backoff, igual aos outros
// erros de validação dessas filas.
export class EanConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EanConflictError";
  }
}

// Garante que nenhum dos EANs candidatos (ean e/ou ean_tribut, conforme a
// integração) já pertence, NA MESMA UNIT BUSINESS, a um product OU está
// vinculado via SupplierMapping, NA MESMA INTEGRAÇÃO, a um product diferente
// do que estamos criando/atualizando. Isso pega o conflito de "mistura"
// (mesmo código no gtin de um produto e no gtin_package de outro) antes de
// estourar erro genérico do Postgres na constraint de banco, e dá contexto
// suficiente pra alertar/revisar manualmente.
export async function assertEanNotOwnedByAnotherProduct(params: {
  productId: string;
  unitBusinessId: string;
  candidates: Array<{ field: string; value?: string | null }>;
  logPrefix: string;
}): Promise<void> {
  const { productId, unitBusinessId, candidates, logPrefix } = params;

  const integrationsId = await resolveIntegrationsIdForUnitBusiness(unitBusinessId);

  for (const { field, value } of candidates) {
    const normalized = normalizeEan(value ?? undefined);
    if (!normalized) continue;

    const conflictingConfig = await ProductConfig.findOne({
      where: {
        unit_business_id: unitBusinessId,
        product_id: { [Op.ne]: productId },
        [Op.or]: [{ gtin: normalized }, { gtin_package: normalized }],
      },
    });

    if (conflictingConfig) {
      throw new EanConflictError(
        `${logPrefix} — ${field}=${normalized} já pertence ao product id=${conflictingConfig.product_id} (produto atual id=${productId})`,
      );
    }

    const conflictingMapping = await SupplierMapping.findOne({
      where: {
        supplier_product_code: normalized,
        integrations_id: integrationsId,
        product_id: { [Op.ne]: productId },
      },
    });

    if (conflictingMapping) {
      throw new EanConflictError(
        `${logPrefix} — ${field}=${normalized} já está vinculado via SupplierMapping ao product id=${conflictingMapping.product_id} (produto atual id=${productId})`,
      );
    }
  }
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

  // 1. ProductConfig.gtin/gtin_package na própria unit business.
  const config = await ProductConfig.findOne({
    where: {
      unit_business_id: unitBusinessId,
      [Op.or]: [{ gtin: normalizedEan }, { gtin_package: normalizedEan }],
    },
    transaction,
  });
  if (config) {
    const product = await Product.findOne({
      where: { id: config.product_id },
      include: includeWithStock,
      transaction,
    });
    if (product) {
      console.log(
        `${logPrefix} — produto resolvido via ProductConfig.gtin/gtin_package (ean=${normalizedEan})`,
      );
      return product;
    }
  }

  // 2. fallback: SupplierMapping pelo EAN, escopado pela integração da unit
  // business (e também exigindo estoque na loja). Sem integrations_id
  // resolvido pra essa unit business não há como escopar a busca — não faz
  // sentido cair pra uma busca global (reabriria a mistura Bling/Tecinco).
  const integrationsId = await resolveIntegrationsIdForUnitBusiness(unitBusinessId, transaction);

  const mapping = await SupplierMapping.findOne({
    where: {
      supplier_product_code: normalizedEan,
      integrations_id: integrationsId,
    },
    transaction,
  });
  if (mapping) {
    const product = await Product.findOne({
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
