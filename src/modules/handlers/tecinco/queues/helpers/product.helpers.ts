import { Op, Transaction, UniqueConstraintError, WhereAttributeHash } from "sequelize";
import { SupplierMappingAttributes } from "../../../../inventory/supplier-mapping/supplier-mapping.types";
import { ProductConfigAttributes } from "../../../../inventory/product-config/product_config.types";
import {
  ProductConfig,
  Product,
  SupplierMapping,
  Stock,
} from "../../../../inventory";
import UnitBusiness from "../../../../company/unit-business/unit-business.model";
import { getCachedIntegrationsIdForUnitBusiness } from "./lookup-cache";
import integrationMappingService from "../../../../integrations/integration-mapping/integration-mapping.service";
import auditLogService from "../../../../global/audit-logs/audit-log.service";
import { AuditAction, AuditEntity } from "../../../../global/audit-logs/audit-log.types";

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
  // Dentro de transaction lê direto (pode enxergar escrita ainda não commitada).
  const integrationsId = transaction
    ? (
        await UnitBusiness.findByPk(unitBusinessId, {
          attributes: ["integrations_id"],
          transaction,
        })
      )?.integrations_id
    : await getCachedIntegrationsIdForUnitBusiness(unitBusinessId);
  if (!integrationsId) {
    throw new Error(
      `UnitBusiness ${unitBusinessId} sem integrations_id configurado`,
    );
  }
  return integrationsId;
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

  // Outro produto usa o EAN (gtin de outra loja ou com outro zero à esquerda): não cria, senão o bipe acharia dois.
  const otherOwnerId = await findAnotherProductUsingEan(ean, product.id, integrationsId);
  if (otherOwnerId) {
    console.warn(
      `${logPrefix} — EAN=${ean} já pertence ao produto ${otherOwnerId} nessa integração (considerando zeros à esquerda) — SupplierMapping do produto ${product.id} não criado`,
    );
    return;
  }

  try {
    await SupplierMapping.create({
      product_id: product.id,
      supplier_product_code: ean,
      integrations_id: integrationsId,
    });
  } catch (err: any) {
    if (err instanceof UniqueConstraintError) {
      // Corrida: outra escrita criou um SupplierMapping com esse código
      // entre o resolveProductByEan acima e este create — não é erro de
      // infra, retry não ajuda.
      throw new SupplierMappingConflictError(
        `Não foi possível vincular: o código ${ean} já está mapeado (SupplierMapping) nessa integração pra outro produto. Encaminhe este erro para o time técnico investigar. [${logPrefix} — EAN=${ean}, produto atual id=${product.id}]`,
      );
    }
    throw err;
  }
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
    if (existing) {
      if (existing.product_id !== productId) {
        // Código já mapeado pra um produto DIFERENTE nessa integração —
        // não sobrescreve/duplica, erro de dado pra revisão manual (quem
        // chama decide como reagir, ver tecinco-api-fetch.queue.ts).
        const [conflictingProduct, currentProduct] = await Promise.all([
          Product.findByPk(existing.product_id, { attributes: ["name"] }),
          Product.findByPk(productId, { attributes: ["name"] }),
        ]);
        throw new SupplierMappingConflictError(
          `Não foi possível vincular: o código ${code} já está mapeado (SupplierMapping) pro produto "${conflictingProduct?.name ?? existing.product_id}" nessa integração, mas está sendo usado agora pro produto "${currentProduct?.name ?? productId}". Encaminhe este erro para o time técnico investigar. [${logPrefix} — ${label}=${code}, produto conflitante id=${existing.product_id}, produto atual id=${productId}]`,
        );
      }
      continue; // já mapeado pro mesmo produto — nada a fazer
    }
    if (!code) continue;
    // EAN com outro zero à esquerda já é de outro produto: pula esse código (o bipe acharia dois), não bloqueia o sync.
    if (
      label === "EAN" &&
      (await findAnotherProductUsingEan(code, productId, integrationsId, { zeroVariantsOnly: true }))
    ) {
      console.warn(`${logPrefix} — EAN=${code} com outro zero à esquerda já é de outro produto — SupplierMapping não criado`);
      continue;
    }
    try {
      await SupplierMapping.create({
        product_id: productId,
        supplier_cnpj: supplierCnpj,
        supplier_product_code: code,
        integrations_id: integrationsId,
      });
      console.log(`${logPrefix} — SupplierMapping criado: ${label}=${code}`);
    } catch (err: any) {
      if (err instanceof UniqueConstraintError) {
        // Corrida: outra escrita criou entre o findOne acima e este create.
        throw new SupplierMappingConflictError(
          `Não foi possível vincular: o código ${code} já está mapeado (SupplierMapping) nessa integração pra outro produto. Encaminhe este erro para o time técnico investigar. [${logPrefix} — ${label}=${code}, produto atual id=${productId}]`,
        );
      }
      throw err;
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

// Resolve um produto físico já existente pelo SKU (ProductConfig.sku), sem
// escopar por unit_business — o mesmo produto pode ter sido criado por outra
// integração, numa unit_business diferente da que está sincronizando agora
// (ex.: criado via Tecinco, sincronizando via Bling, ou vice-versa). Usado
// pra auto-mapear em vez de duplicar o Product quando o código do
// fabricante/SKU já bate com um produto existente — Bling manda isso como
// `codigo`, Tecinco como `epctb_codigofabrica`; os dois representam o mesmo
// conceito (SKU/código de fábrica do produto físico). Só se aplica a
// produtos unitários — KIT nunca passa por aqui (seu código é sintético,
// nunca deveria colidir com o SKU de um produto existente).
export async function resolveProductBySku(
  sku: string | null | undefined,
  logPrefix: string,
): Promise<typeof Product.prototype | null> {
  const trimmed = sku?.trim();
  if (!trimmed) return null;

  const config = await ProductConfig.findOne({ where: { sku: trimmed } });
  if (!config) return null;

  const product = await Product.findByPk(config.product_id);
  if (!product) return null;

  console.log(
    `${logPrefix} — produto resolvido via ProductConfig.sku (sku=${trimmed}) — auto-mapeando em vez de criar um novo`,
  );

  return product;
}

// Terceiro nível de fallback (depois de integration_mapping e
// resolveProductBySku): resolve um produto já existente via SupplierMapping
// — diferente de resolveProductBySku, este é escopado pela integração que
// está sincronizando (integrations_id), já que SupplierMapping já é uma
// tabela por-integração por natureza (supplier_product_code só faz sentido
// dentro do contexto de uma integração específica).
export async function resolveProductBySupplierMapping(
  code: string | null | undefined,
  integrationsId: string,
  logPrefix: string,
): Promise<typeof Product.prototype | null> {
  const trimmed = code?.trim();
  if (!trimmed) return null;

  const mapping = await SupplierMapping.findOne({
    where: { supplier_product_code: trimmed, integrations_id: integrationsId },
  });
  if (!mapping) return null;

  const product = await Product.findByPk(mapping.product_id);
  if (!product) return null;

  console.log(
    `${logPrefix} — produto resolvido via SupplierMapping (code=${trimmed}, integrations_id=${integrationsId})`,
  );

  return product;
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

// Mesma natureza do EanConflictError acima, mas especificamente pra
// SupplierMapping: só pode existir uma linha de SupplierMapping por
// (integrations_id, supplier_product_code) — ver ensureSupplierMappings/
// backfillSupplierMappingByEan e o índice único parcial
// product_supplier_maps_integrations_id_code_unique (m263) + trigger
// trigger_prevent_duplicate_supplier_mapping (m272).
export class SupplierMappingConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SupplierMappingConflictError";
  }
}

// Garante que nenhum dos EANs candidatos (exato ou com outro zero à esquerda) já é gtin de outro produto em
// QUALQUER loja da integração (erro) nem DE x PARA comum de outro produto nela (removido) — validação sempre por integração.
// Só considera ProductConfig.gtin — gtin_package não participa de nenhuma checagem.
export async function assertEanNotOwnedByAnotherProduct(params: {
  productId: string;
  unitBusinessId: string;
  candidates: Array<{ field: string; value?: string | null }>;
  logPrefix: string;
  transaction?: Transaction;
  // Edição manual (não sync): a remoção do DE x PARA do outro produto entra na auditoria com quem fez.
  audit?: { userId: string | null };
}): Promise<void> {
  const { productId, unitBusinessId, candidates, logPrefix, transaction, audit } = params;

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
    // gtin de outro produto em qualquer loja da integração, exato ou com outro zero à esquerda (o bipe acharia dois).
    const codes = buildEanZeroVariants(normalized);
    const conflictingProductId = await findGtinOwnerId(codes, productId, integrationsId, transaction);

    if (conflictingProductId) {
      const [conflictingProduct, currentProduct] = await Promise.all([
        Product.findByPk(conflictingProductId, {
          attributes: ["name"],
          transaction,
        }),
        Product.findByPk(productId, { attributes: ["name"], transaction }),
      ]);
      throw new EanConflictError(
        `Não foi possível salvar: o código ${normalized} já pertence ao produto "${conflictingProduct?.name ?? conflictingProductId}", mas está sendo usado agora pro produto "${currentProduct?.name ?? productId}". Encaminhe este erro para o time técnico investigar. [${logPrefix} — ${field}=${normalized}, produto conflitante id=${conflictingProductId}, produto atual id=${productId}]`,
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
        supplier_product_code: { [Op.in]: codes },
        integrations_id: integrationsId,
        product_id: { [Op.ne]: productId },
      },
      transaction,
    });

    // EAN físico confirmado (exato ou com zero à esquerda) de outro produto nunca é removido por aqui —
    // quem tenta gravar o gtin é que está errado.
    const physicalOverride = await findPhysicalOverrideForEan(normalized, productId, integrationsId, transaction);
    if (physicalOverride) {
      const [ownerProduct, currentProduct] = await Promise.all([
        Product.findByPk(physicalOverride.product_id, { attributes: ["name"], transaction }),
        Product.findByPk(productId, { attributes: ["name"], transaction }),
      ]);
      throw new EanConflictError(
        `O EAN ${normalized} foi confirmado como EAN físico do produto "${ownerProduct?.name ?? physicalOverride.product_id}" e não pode ser usado no produto "${currentProduct?.name ?? productId}". [${logPrefix} — ${field}=${normalized}, EAN confirmado=${physicalOverride.supplier_product_code}, produto dono id=${physicalOverride.product_id}, produto atual id=${productId}]`,
      );
    }

    if (conflictingMapping) {
      console.warn(
        `${logPrefix} — ${field}=${normalized} estava vinculado via SupplierMapping (id=${conflictingMapping.id}) ao product id=${conflictingMapping.product_id} — desatualizado, removendo pra liberar pro product id=${productId}`,
      );
      await conflictingMapping.destroy({ transaction });

      if (audit) {
        const summary = `Código ${conflictingMapping.supplier_product_code} saiu do Mapeamento DE x PARA deste produto porque foi gravado como EAN de outro produto`;
        const before = { supplier_product_code: conflictingMapping.supplier_product_code };
        await auditLogService.record(
          [
            {
              userId: audit.userId,
              entity: AuditEntity.SUPPLIER_MAPPING,
              internalId: conflictingMapping.id,
              action: AuditAction.DELETE,
              changes: { summary, before, after: null, origin: { entity: AuditEntity.PRODUCT, internal_id: productId } },
            },
            {
              userId: audit.userId,
              entity: AuditEntity.PRODUCT,
              internalId: conflictingMapping.product_id,
              action: AuditAction.UPDATE,
              changes: {
                summary,
                affected: [
                  { entity: AuditEntity.SUPPLIER_MAPPING, internal_id: conflictingMapping.id, action: AuditAction.DELETE, before, after: null },
                ],
              },
            },
          ],
          transaction,
        );
      }
    }
  }
}

// Verifica, ao vivo (sem depender de nenhum índice/flag pré-calculado), se
// um código (sku ou gtin) já pertence a OUTRO produto dentro da MESMA
// integração — via ProductConfig (em qualquer unit_business da integração)
// ou SupplierMapping. Usado só na criação manual de produto a partir de um
// unmapped (createProductFromTCarData, em tecinco-api-fetch.queue.ts) pra
// decidir se o campo pode ser preenchido com segurança ou precisa ficar
// vazio — NÃO bloqueia a criação do produto (o produto é criado mesmo
// assim, só sem esse campo/sem SupplierMapping pra ele); o único lugar que
// efetivamente barra com erro por código ambíguo é a criação do
// SupplierMapping em si (ver SupplierMappingConflictError). Não recebe
// productId pra excluir — nesse ponto o produto ainda não existe, então
// qualquer ocorrência já é "outro produto" por definição.
export async function isCodeOwnedByAnotherProduct(params: {
  code: string;
  field: "sku" | "gtin";
  integrationsId: string;
  // Sync de produto já existente: o próprio produto não conta como "outro".
  excludeProductId?: string;
}): Promise<boolean> {
  const { code, field, integrationsId, excludeProductId } = params;
  const notOwn = excludeProductId ? { product_id: { [Op.ne]: excludeProductId } } : {};

  const unitBusinesses = await UnitBusiness.findAll({
    where: { integrations_id: integrationsId },
    attributes: ["id"],
  });
  const unitBusinessIds = unitBusinesses.map((ub) => ub.id);

  // gtin considera zeros à esquerda (o bipe acharia dois); sku segue exato — SKUs distintos podem diferir só pelo zero.
  let codeMatch: string | { [Op.in]: string[] } = code;
  if (field === "gtin") codeMatch = { [Op.in]: buildEanZeroVariants(code) };

  const conflictingConfig = unitBusinessIds.length
    ? await ProductConfig.findOne({
        where: { [field]: codeMatch, unit_business_id: { [Op.in]: unitBusinessIds }, ...notOwn },
      })
    : null;
  if (conflictingConfig) return true;

  const conflictingMapping = await SupplierMapping.findOne({
    where: { supplier_product_code: codeMatch, integrations_id: integrationsId, ...notOwn },
  });
  return !!conflictingMapping;
}

// DE x PARA com EAN físico confirmado (is_physical_override) pra esse EAN — exato ou com zero à esquerda — em
// OUTRO produto da integração (excludeProductId null = qualquer produto). Sync usa pra omitir o EAN.
export async function findPhysicalOverrideForEan(
  ean: string | null | undefined,
  excludeProductId: string | null,
  integrationsId: string,
  transaction?: Transaction,
): Promise<typeof SupplierMapping.prototype | null> {
  const normalized = normalizeEan(ean ?? undefined);
  if (!normalized) return null;

  const where: WhereAttributeHash<SupplierMappingAttributes> = {
    supplier_product_code: { [Op.in]: buildEanZeroVariants(normalized) },
    integrations_id: integrationsId,
    is_physical_override: true,
  };
  if (excludeProductId) where.product_id = { [Op.ne]: excludeProductId };

  return SupplierMapping.findOne({
    where,
    attributes: ["id", "product_id", "supplier_product_code"],
    transaction,
  });
}

// Dono (outro produto) de algum dos códigos como gtin em QUALQUER loja da integração — validação de EAN é sempre
// por integração, nunca por loja. productId null = qualquer produto.
async function findGtinOwnerId(
  codes: string[],
  productId: string | null,
  integrationsId: string,
  transaction?: Transaction,
): Promise<string | null> {
  if (!codes.length) return null;
  const where: WhereAttributeHash<ProductConfigAttributes> = { gtin: { [Op.in]: codes } };
  if (productId) where.product_id = { [Op.ne]: productId };

  const config = await ProductConfig.findOne({
    where,
    attributes: ["product_id"],
    include: [
      {
        model: UnitBusiness,
        as: "unitBusiness",
        attributes: [],
        where: { integrations_id: integrationsId },
        required: true,
      },
    ],
    transaction,
  });
  return config?.product_id ?? null;
}

// Dono (outro produto) de algum dos códigos como DE x PARA da integração. productId null = qualquer produto.
async function findMappingOwnerId(
  codes: string[],
  productId: string | null,
  integrationsId: string,
  transaction?: Transaction,
): Promise<string | null> {
  if (!codes.length) return null;
  const where: WhereAttributeHash<SupplierMappingAttributes> = {
    supplier_product_code: { [Op.in]: codes },
    integrations_id: integrationsId,
  };
  if (productId) where.product_id = { [Op.ne]: productId };

  const mapping = await SupplierMapping.findOne({ where, attributes: ["product_id"], transaction });
  return mapping?.product_id ?? null;
}

// Outro produto da integração já usa o código (exato ou com zero à esquerda) como DE x PARA ou gtin de alguma loja
// dela? Devolve o product_id dele, ou null. zeroVariantsOnly ignora o exato (quem chama já trata o conflito exato).
export async function findAnotherProductUsingEan(
  code: string | null | undefined,
  productId: string | null,
  integrationsId: string,
  opts: { zeroVariantsOnly?: boolean; transaction?: Transaction } = {},
): Promise<string | null> {
  const normalized = normalizeEan(code ?? undefined);
  if (!normalized) return null;

  let codes = buildEanZeroVariants(normalized);
  if (opts.zeroVariantsOnly) codes = codes.filter((variant) => variant !== normalized);

  const [mappingOwnerId, gtinOwnerId] = await Promise.all([
    findMappingOwnerId(codes, productId, integrationsId, opts.transaction),
    findGtinOwnerId(codes, productId, integrationsId, opts.transaction),
  ]);
  return mappingOwnerId ?? gtinOwnerId;
}

// O sync não pode gravar esse EAN no produto: EAN físico confirmado de outro produto, gtin de outro produto em qualquer
// loja da integração (exato ou com zero), ou DE x PARA de outro com outro zero à esquerda. productId null = produto novo.
// (DE x PARA exato de outro produto fica de fora de propósito: assertEanNotOwnedByAnotherProduct remove ele — gtin do ERP vence.)
export async function isEanBlockedForProduct(
  ean: string | null | undefined,
  productId: string | null,
  integrationsId: string,
  transaction?: Transaction,
): Promise<boolean> {
  const normalized = normalizeEan(ean ?? undefined);
  if (!normalized) return false;

  const codes = buildEanZeroVariants(normalized);
  const [override, gtinOwnerId, mappingOwnerId] = await Promise.all([
    findPhysicalOverrideForEan(normalized, productId, integrationsId, transaction),
    findGtinOwnerId(codes, productId, integrationsId, transaction),
    findMappingOwnerId(codes.filter((variant) => variant !== normalized), productId, integrationsId, transaction),
  ]);
  return !!override || !!gtinOwnerId || !!mappingOwnerId;
}

// Resolve o produto de um item de nota pelo DE x PARA (EAN da nota, exato ou com zero à esquerda) na integração.
// Mais de um produto → null (vira não mapeado) em vez de escolher um no chute.
export async function resolveProductIdBySupplierMappingEan(
  ean: string | null | undefined,
  integrationsId: string,
  logPrefix: string,
): Promise<string | null> {
  const normalized = normalizeEan(ean ?? undefined);
  if (!normalized) return null;

  const mappings = await SupplierMapping.findAll({
    where: {
      supplier_product_code: { [Op.in]: buildEanZeroVariants(normalized) },
      integrations_id: integrationsId,
    },
    attributes: ["product_id"],
  });
  const productIds = [...new Set(mappings.map((mapping) => mapping.product_id))];
  if (productIds.length > 1) {
    console.warn(
      `${logPrefix} — EAN=${normalized} corresponde a mais de um produto via SupplierMapping (considerando zeros à esquerda): ${productIds.join(", ")} — item não resolvido`,
    );
    return null;
  }
  return productIds[0] ?? null;
}

// Versão em lote de findPhysicalOverrideForEan (uma query pra todos os EANs de uma nota):
// código (exato e variações de zero) → product_id dono do override.
export async function findPhysicalOverridesForEans(
  eans: Array<string | null | undefined>,
  integrationsId: string,
): Promise<Map<string, string>> {
  const codes = [
    ...new Set(
      eans.flatMap((ean) => {
        const normalized = normalizeEan(ean ?? undefined);
        return normalized ? buildEanZeroVariants(normalized) : [];
      }),
    ),
  ];
  if (!codes.length) return new Map();

  const overrides = await SupplierMapping.findAll({
    where: {
      supplier_product_code: { [Op.in]: codes },
      integrations_id: integrationsId,
      is_physical_override: true,
    },
    attributes: ["product_id", "supplier_product_code"],
  });
  return new Map(overrides.map((sm) => [sm.supplier_product_code, sm.product_id]));
}

// Chave que junta o mesmo GTIN com/sem zero à esquerda (12–14 dígitos); outros códigos ficam como estão.
export function eanZeroInsensitiveKey(code: string): string {
  return /^\d{12,14}$/.test(code) ? code.replace(/^0+/, "") || "0" : code;
}

// Código exato + variações de zero à esquerda até GTIN-14 (ex.: 4019238588644 ↔ 04019238588644), exato primeiro.
// Variação só pra GTIN de 12–14 dígitos: SupplierMapping também guarda SKU/codigoFabrica (10/11/18 dígitos),
// e no catálogo Tecinco há SKUs distintos que diferem só pelo zero (ex.: 03117120000 ≠ 3117120000).
export function buildEanZeroVariants(ean: string): string[] {
  const codes = [ean];
  const stripped = ean.replace(/^0+/, "");
  if (/^\d{12,14}$/.test(ean) && stripped) {
    for (let len = Math.max(stripped.length, 12); len <= 14; len++) {
      const variant = stripped.padStart(len, "0");
      if (variant !== ean) codes.push(variant);
    }
  }
  return codes;
}

// Scan de inventário: busca o EAN exato + variações de zeros à esquerda (até GTIN-14, ex.: 4019238588644 ↔
// 04019238588644) em ProductConfig.gtin e SupplierMapping, ambos da integração. Só resolve se der um único produto.
export async function resolveProductByEanWithStock(params: {
  ean: string;
  unitBusinessId: string;
  transaction?: Transaction;
  logPrefix: string;
}): Promise<typeof Product.prototype | null> {
  const { ean, unitBusinessId, transaction, logPrefix } = params;

  const normalizedEan = normalizeEan(ean);
  if (!normalizedEan) return null;

  const codes = buildEanZeroVariants(normalizedEan);

  // Sem integrations_id resolvido não há como escopar o SupplierMapping — não cai pra busca global
  // (reabriria a mistura Bling/Tecinco).
  const integrationsId = await resolveIntegrationsIdForUnitBusiness(unitBusinessId, transaction);

  // gtin de qualquer loja da integração (validação de EAN é por integração, nunca por loja).
  const configs = await ProductConfig.findAll({
    attributes: ["product_id"],
    where: { gtin: { [Op.in]: codes } },
    include: [
      {
        model: UnitBusiness,
        as: "unitBusiness",
        attributes: [],
        where: { integrations_id: integrationsId },
        required: true,
      },
    ],
    transaction,
  });
  const mappings = await SupplierMapping.findAll({
    attributes: ["product_id"],
    where: { supplier_product_code: { [Op.in]: codes }, integrations_id: integrationsId },
    transaction,
  });
  const productIds = [
    ...new Set([...configs, ...mappings].map((row) => row.product_id)),
  ];
  if (!productIds.length) return null;
  if (productIds.length > 1) {
    throw new Error(
      `Código ${normalizedEan} corresponde a mais de um produto (considerando zeros à esquerda) — não é possível bipar`,
    );
  }

  const product = await Product.findOne({
    where: { id: productIds[0] },
    include: [
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
    ],
    transaction,
  });
  if (product) {
    console.log(`${logPrefix} — produto resolvido por EAN=${normalizedEan}: id=${product.id}`);
  }
  return product;
}
