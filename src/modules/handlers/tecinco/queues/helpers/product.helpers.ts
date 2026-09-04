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
export async function resolveIntegrationsIdForUnitBusiness(
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

// Product.integrations_id é o "dono" dos campos descritivos compartilhados
// (name, brand, measure, weight, subgroup etc.) — únicos por produto, não
// por integração. Quando o mesmo produto físico está mapeado em mais de uma
// integração (via integration_mappings, ex.: catálogo Bling + Tecinco
// reconciliados manualmente), só o dono pode sobrescrever esses campos na
// sincronização; as outras integrações só atualizam o que é realmente delas
// (ProductConfig/Stock/SupplierMapping da própria unit business). Produto
// sem dono ainda (integrations_id nulo) pode ser reivindicado por quem
// sincronizar primeiro.
export function isProductOwnedByIntegration(
  product: { integrations_id?: string | null },
  integrationsId: string,
): boolean {
  return !product.integrations_id || product.integrations_id === integrationsId;
}

// Fonte da verdade de "qual produto local é esse código externo": SEMPRE
// integration_mappings, nunca Product.id_system direto. id_system é só um
// campo informativo (o último valor visto vindo da integração) — resolver
// por ele direto já causou produto errado sendo escolhido quando o mesmo
// id_system foi reaproveitado/alterado do lado de fora sem o mapping
// acompanhar. Sem side effects — não cria SupplierMapping nem nada; é só
// leitura, usada tanto por fluxos que escrevem (resolveProductWithMapping)
// quanto por fluxos só de leitura (ex.: conferência de estoque).
export async function resolveProductByMappingOnly(params: {
  unitBusinessId: string;
  systemId: string;
  logPrefix: string;
}): Promise<typeof Product.prototype | null> {
  const { unitBusinessId, systemId, logPrefix } = params;

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

  return mappedProduct as typeof Product.prototype;
}

// Regra: sempre que um produto é resolvido via integration mapping e ele tem
// EAN, esse EAN precisa estar registrado como SupplierMapping. Se o EAN já
// corresponde a algum produto ou supplier mapping existente NA MESMA
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

// Resolve produto SÓ por integration_mapping (via resolveProductByMappingOnly)
// e, se encontrado, garante o SupplierMapping do EAN (backfill). Usado pelos
// fluxos que criam/atualizam produto (Bling/Tecinco upsert) — se não tem
// mapping, não resolve — quem chama decide o que fazer (registrar em
// unmapped_invoice_products, não criar produto sozinho). Fluxos só de
// leitura (sem transação de escrita em andamento) devem usar
// resolveProductByMappingOnly diretamente, sem o backfill.
export async function resolveProductWithMapping(params: {
  unitBusinessId: string;
  systemId: string;
  ean?: string;
  logPrefix: string;
}): Promise<typeof Product.prototype | null> {
  const { unitBusinessId, systemId, ean, logPrefix } = params;

  const resolved = await resolveProductByMappingOnly({ unitBusinessId, systemId, logPrefix });
  if (!resolved) return null;

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
      gtin: normalizedEan,
    },
  });
  if (config) {
    const product = await Product.findByPk(config.product_id);
    if (product) {
      console.log(
        `${logPrefix} — produto resolvido via ProductConfig.gtin (ean=${normalizedEan})`,
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

// Garante que nenhum dos EANs candidatos já pertence, NA MESMA UNIT
// BUSINESS, a um product OU está vinculado via SupplierMapping, NA MESMA
// INTEGRAÇÃO, a um product diferente do que estamos criando/atualizando.
// Isso pega o conflito antes de estourar erro genérico do Postgres na
// constraint de banco, e dá contexto suficiente pra alertar/revisar
// manualmente. Só considera ProductConfig.gtin — gtin_package não participa
// de nenhuma checagem, é só um campo guardado para uso futuro.
export async function assertEanNotOwnedByAnotherProduct(params: {
  productId: string;
  unitBusinessId: string;
  candidates: Array<{ field: string; value?: string | null }>;
  logPrefix: string;
  transaction?: Transaction;
}): Promise<void> {
  const { productId, unitBusinessId, candidates, logPrefix, transaction } = params;

  const integrationsId = await resolveIntegrationsIdForUnitBusiness(
    unitBusinessId,
    transaction,
  );

  for (const { field, value } of candidates) {
    const normalized = normalizeEan(value ?? undefined);
    if (!normalized) continue;

    // ProductConfig.gtin é dado primário — vem direto do sync do catálogo
    // da integração dona do produto. Se colide com o de OUTRO produto, os
    // dois lados são igualmente autoritativos e não dá pra saber qual está
    // certo sem revisão humana — trava e alerta (ver callers).
    const conflictingConfig = await ProductConfig.findOne({
      where: {
        unit_business_id: unitBusinessId,
        product_id: { [Op.ne]: productId },
        gtin: normalized,
      },
      transaction,
    });

    if (conflictingConfig) {
      const [conflictingProduct, currentProduct] = await Promise.all([
        Product.findByPk(conflictingConfig.product_id, {
          attributes: ["name"],
          transaction,
        }),
        Product.findByPk(productId, { attributes: ["name"], transaction }),
      ]);
      throw new EanConflictError(
        `Não foi possível salvar: o código ${normalized} já pertence ao produto "${conflictingProduct?.name ?? conflictingConfig.product_id}", mas está sendo usado agora pro produto "${currentProduct?.name ?? productId}". Encaminhe este erro para o time técnico investigar. [${logPrefix} — ${field}=${normalized}, produto conflitante id=${conflictingConfig.product_id}, produto atual id=${productId}]`,
      );
    }

    // SupplierMapping é um sinal inferido (veio do código de um fornecedor
    // numa nota, não da própria integração dona do produto) — mais fraco que
    // o ProductConfig.gtin que está sendo gravado agora. Se colidir, o
    // mapping antigo ficou desatualizado (ex.: a integração reatribuiu esse
    // código pra outro produto) — remove ele automaticamente em vez de
    // travar a escrita do gtin novo, senão o produto fica preso num conflito
    // que nunca se resolve sozinho.
    const conflictingMapping = await SupplierMapping.findOne({
      where: {
        supplier_product_code: normalized,
        integrations_id: integrationsId,
        product_id: { [Op.ne]: productId },
      },
      transaction,
    });

    if (conflictingMapping) {
      console.warn(
        `${logPrefix} — ${field}=${normalized} estava vinculado via SupplierMapping (id=${conflictingMapping.id}) ao product id=${conflictingMapping.product_id} — desatualizado, removendo pra liberar pro product id=${productId}`,
      );
      await conflictingMapping.destroy({ transaction });
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

  // 1. ProductConfig.gtin na própria unit business.
  const config = await ProductConfig.findOne({
    where: {
      unit_business_id: unitBusinessId,
      gtin: normalizedEan,
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
        `${logPrefix} — produto resolvido via ProductConfig.gtin (ean=${normalizedEan})`,
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
