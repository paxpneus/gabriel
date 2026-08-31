import { Op, Transaction } from "sequelize";
import {
  ProductConfig,
  Product,
  SupplierMapping,
  Stock,
} from "../../../../inventory";
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

// Resolve produto SÓ por integration_mapping — sem fallback por id_system,
// ProductConfig.sku, EAN ou SupplierMapping. Esses fallbacks já causaram
// mappings errados/produtos duplicados no passado (ver contexto da sessão de
// matching Tecinco↔local); a partir de agora, se não tem mapping, não
// resolve — quem chama decide o que fazer (registrar em
// unmapped_invoice_products, não criar produto sozinho).
export async function resolveProductWithMapping(params: {
  integrationsId: string;
  systemId: string;
  ean?: string;
  logPrefix: string;
}): Promise<typeof Product.prototype | null> {
  const { integrationsId, systemId, ean, logPrefix } = params;

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
  await backfillSupplierMappingByEan({ product: resolved, ean, logPrefix });

  return resolved;
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
// integração) já pertence a um product OU está vinculado via SupplierMapping
// a um product diferente do que estamos criando/atualizando. Isso pega o
// conflito de "mistura" (mesmo EAN em ean de um produto e ean_tribut de
// outro) antes de estourar erro genérico do Postgres na constraint de banco,
// e dá contexto suficiente pra alertar/revisar manualmente.
export async function assertEanNotOwnedByAnotherProduct(params: {
  productId: string;
  candidates: Array<{ field: string; value?: string | null }>;
  logPrefix: string;
}): Promise<void> {
  const { productId, candidates, logPrefix } = params;

  for (const { field, value } of candidates) {
    const normalized = normalizeEan(value ?? undefined);
    if (!normalized) continue;

    const conflictingProduct = await Product.findOne({
      where: {
        id: { [Op.ne]: productId },
        [Op.or]: [{ ean: normalized }, { ean_tribut: normalized }],
      },
    });

    if (conflictingProduct) {
      throw new EanConflictError(
        `${logPrefix} — ${field}=${normalized} já pertence ao product id=${conflictingProduct.id} (produto atual id=${productId})`,
      );
    }

    const conflictingMapping = await SupplierMapping.findOne({
      where: {
        supplier_product_code: normalized,
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



