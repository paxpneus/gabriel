import {
  CreateOptions,
  ForeignKeyConstraintError,
  Op,
  Transaction,
  UniqueConstraintError,
} from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import SupplierMapping from "./supplier-mapping.model";
import supplierMappingRepository, {
  SupplierMappingRepository,
} from "./supplier-mapping.repository";
import {
  EanOwners,
  EanOwnerSummary,
  IntegrationPendingSection,
  ErpEanClaim,
  ErpEanClaimProduct,
  ErpEanPrevailing,
  FullSupplierMapping,
  ProductSupplierMappingInput,
  SupplierMappingError,
  SupplierMappingErrorCode,
  SupplierMappingCreationAttributes,
} from "./supplier-mapping.types";
import {
  buildEanZeroVariants,
  eanZeroInsensitiveKey,
  normalizeEan,
  resolveIntegrationsIdForUnitBusiness,
} from "../../handlers/tecinco/queues/helpers/product.helpers";
import productConfigService from "../product-config/product_config.service";
import ProductConfig from "../product-config/product_config.model";
import sequelize from "../../../config/sequelize";
import unmappedInvoiceProductService from "../unmapped-invoice-product/unmapped-invoice-product.service";
import integrationMappingService from "../../integrations/integration-mapping/integration-mapping.service";
import {
  QueryParams,
  PaginatedResult,
} from "../../../shared/query/query.types";
import Integration from "../../integrations/integrations/integrations.model";
import integrationsService from "../../integrations/integrations/integrations.service";
import auditLogService from "../../global/audit-logs/audit-log.service";
import {
  AuditAction,
  AuditAffectedEntity,
  AuditEntity,
  AuditLogEntry,
} from "../../global/audit-logs/audit-log.types";

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

    const integrationsId =
      await resolveIntegrationsIdForUnitBusiness(unitBusinessId);

    const supplierFound = await this.repository.findSupplierByProductCode(
      ean,
      integrationsId,
    );

    if (!supplierFound) return null;

    return supplierFound;
  }

  // Quem (além de excludeProductId) usa o EAN — exato ou com zero à esquerda — na integração:
  // SupplierMapping da integração e ProductConfig.gtin de qualquer loja dela.
  async findEanOwners(
    ean: string,
    integrationsId: string,
    excludeProductId: string | null,
    transaction?: Transaction,
  ): Promise<EanOwners> {
    const normalized = normalizeEan(ean);
    if (!normalized) return { supplierMappings: [], productConfigs: [] };

    const codes = buildEanZeroVariants(normalized);
    const [supplierMappings, productConfigs] = await Promise.all([
      this.repository.findCodeOwnersInIntegration(codes, integrationsId, excludeProductId, transaction),
      productConfigService.findGtinOwnersInIntegration(codes, integrationsId, excludeProductId, transaction),
    ]);
    return { supplierMappings, productConfigs };
  }

  // Produto sem integration_mapping na integração → erro com code pro front abrir o registro com foto.
  private async assertProductMappedInIntegration(
    productId: string,
    integrationsId: string,
    transaction?: Transaction,
  ): Promise<void> {
    const mapped = await integrationMappingService.findExternalIdsMap(
      "PRODUCT",
      integrationsId,
      [productId],
      transaction,
    );
    if (!mapped.has(productId)) {
      throw new SupplierMappingError(
        SupplierMappingErrorCode.PRODUCT_NOT_MAPPED_IN_INTEGRATION,
        "Este produto ainda não está vinculado a esta integração. Registre o produto com foto para que ele seja cadastrado ou vinculado.",
      );
    }
  }

  // EAN já confirmado como EAN físico de outro produto: monta o erro com quem fez/quando (último log do mapeamento).
  private async buildPhysicalOverrideError(
    override: SupplierMapping,
    transaction?: Transaction,
  ): Promise<SupplierMappingError> {
    const author = (
      await auditLogService.findLatestAuthors(AuditEntity.SUPPLIER_MAPPING, [override.id], transaction)
    ).get(override.id);
    const productName = override.product?.name ?? null;
    const byWhom = author
      ? ` por ${author.user_name ?? "usuário não identificado"} em ${new Date(author.date).toLocaleString("pt-BR")}`
      : "";

    return new SupplierMappingError(
      SupplierMappingErrorCode.EAN_HAS_PHYSICAL_OVERRIDE,
      `O EAN ${override.supplier_product_code} já foi confirmado como EAN físico do produto "${productName ?? override.product_id}"${byWhom}. Registre o produto com foto para revisão.`,
      undefined,
      {
        supplier_mapping_id: override.id,
        product_id: override.product_id,
        product_name: productName,
        code: override.supplier_product_code,
        user_id: author?.user_id ?? null,
        user_name: author?.user_name ?? null,
        at: author?.date ?? null,
      },
    );
  }

  // EAN (exato ou com zero à esquerda) já é de outro produto na integração → erro com code: EAN físico confirmado
  // de outro produto (EAN_HAS_PHYSICAL_OVERRIDE) ou só em uso (EAN_OWNED_BY_ANOTHER_PRODUCT, com os donos).
  async assertEanFreeForProduct(
    code: string,
    integrationsId: string,
    productId: string,
    transaction?: Transaction,
  ): Promise<void> {
    const owners = await this.findEanOwners(code, integrationsId, productId, transaction);
    const override = owners.supplierMappings.find((sm) => sm.is_physical_override);
    if (override) throw await this.buildPhysicalOverrideError(override, transaction);

    const summary = this.summarizeEanOwners(owners);
    if (!summary.length) return;

    const names = summary
      .map((owner) =>
        owner.source === "PRODUCT_CONFIG"
          ? `"${owner.product_name ?? owner.product_id}" (Configurações do produto, loja ${owner.unit_business_name ?? owner.unit_business_id})`
          : `"${owner.product_name ?? owner.product_id}" (Mapeamento DE x PARA)`,
      )
      .join(", ");
    throw new SupplierMappingError(
      SupplierMappingErrorCode.EAN_OWNED_BY_ANOTHER_PRODUCT,
      `O EAN ${code} já está em uso por: ${names}. Se o produto bipado é este, use "Confirmar EAN físico".`,
      summary,
    );
  }

  // Donos do EAN no formato de resposta (SupplierMapping e Configurações do produto por loja).
  private summarizeEanOwners(owners: EanOwners): EanOwnerSummary[] {
    return [
      ...owners.supplierMappings.map((sm) => ({
        product_id: sm.product_id,
        product_name: sm.product?.name ?? null,
        source: "SUPPLIER_MAPPING" as const,
        code: sm.supplier_product_code,
      })),
      ...owners.productConfigs.map((pc) => ({
        product_id: pc.product_id,
        product_name: (pc as any).product?.name ?? null,
        source: "PRODUCT_CONFIG" as const,
        code: pc.gtin as string,
        unit_business_id: pc.unit_business_id,
        unit_business_name: (pc as any).unitBusiness?.name ?? null,
      })),
    ];
  }

  // "Confirmar EAN físico": EAN exclusivo do produto na integração — zera/apaga o EAN (com zeros à esquerda) dos outros,
  // marca o DE x PARA do produto como override e audita; override de outro produto nunca é derrubado (erro, nada muda).
  async assignPhysicalOwner(params: {
    productId: string;
    ean: string;
    integrationsId: string;
    userId: string | null;
  }): Promise<{ supplierMapping: SupplierMapping; cleared: EanOwnerSummary[] }> {
    const { productId, integrationsId, userId } = params;
    const code = normalizeEan(params.ean);
    if (!code) throw new Error("Informe o EAN bipado");

    const integration = await integrationsService.findById(integrationsId, { attributes: ["id", "name"] });
    if (!integration) throw new Error("Integração não encontrada");

    await this.assertProductMappedInIntegration(productId, integrationsId);

    return sequelize.transaction(async (t) => {
      const owners = await this.findEanOwners(code, integrationsId, productId, t);

      const otherOverride = owners.supplierMappings.find((sm) => sm.is_physical_override);
      if (otherOverride) throw await this.buildPhysicalOverrideError(otherOverride, t);

      // Zera gtin antes de apagar o DE x PARA: os triggers m263/m272 validam o código contra o gtin de outros produtos.
      if (owners.productConfigs.length) {
        await productConfigService.bulkUpdate(
          { gtin: null as unknown as string },
          { where: { id: { [Op.in]: owners.productConfigs.map((pc) => pc.id) } }, transaction: t },
        );
      }
      if (owners.supplierMappings.length) {
        await this.repository.bulkDelete({
          where: { id: { [Op.in]: owners.supplierMappings.map((sm) => sm.id) } },
          transaction: t,
        });
      }

      // Depois da limpeza, o código exato só pode estar no próprio produto: marca o existente ou cria.
      const own = await this.repository.findOne({
        where: { integrations_id: integrationsId, supplier_product_code: code },
        attributes: ["id", "is_physical_override"],
        transaction: t,
      });
      const ownAction = own ? AuditAction.UPDATE : AuditAction.CREATE;
      if (own) {
        await this.repository.bulkUpdate({ is_physical_override: true }, { where: { id: own.id }, transaction: t });
      }
      const supplierMappingId =
        own?.id ??
        (
          await this.create(
            {
              product_id: productId,
              supplier_product_code: code,
              integrations_id: integrationsId,
              is_physical_override: true,
            },
            { transaction: t },
          )
        ).id;

      const closedScanRows = await unmappedInvoiceProductService.closeScanRowsByEan(
        buildEanZeroVariants(code),
        integrationsId,
        t,
      );

      const supplierMapping = (await this.repository.findWithProductName(supplierMappingId, t))!;
      const productName = supplierMapping.product?.name ?? productId;
      const cleared = this.summarizeEanOwners(owners);

      await auditLogService.record(
        this.buildPhysicalOwnerAuditEntries({
          productId,
          productName,
          code,
          integrationName: integration.name,
          userId,
          supplierMappingId,
          ownAction,
          ownWasOverride: !!own?.is_physical_override,
          owners,
          closedScanRows,
        }),
        t,
      );

      return { supplierMapping, cleared };
    });
  }

  // Entradas de auditoria do "Confirmar EAN físico": uma do produto dono com tudo o que foi afetado, e uma por
  // entidade afetada (DE x PARA do dono, cada Configuração zerada, cada DE x PARA apagado, cada produto que perdeu o EAN).
  private buildPhysicalOwnerAuditEntries(params: {
    productId: string;
    productName: string;
    code: string;
    integrationName: string;
    userId: string | null;
    supplierMappingId: string;
    ownAction: AuditAction;
    ownWasOverride: boolean;
    owners: EanOwners;
    closedScanRows: number;
  }): AuditLogEntry[] {
    const { productId, productName, code, integrationName, userId, supplierMappingId, ownAction, ownWasOverride, owners, closedScanRows } = params;
    const origin = { entity: AuditEntity.PRODUCT, internal_id: productId, label: `"${productName}"` };

    const ownMapping: AuditAffectedEntity = {
      entity: AuditEntity.SUPPLIER_MAPPING,
      internal_id: supplierMappingId,
      action: ownAction,
      label: `com o código "${code}"`,
      before: null,
      after: { supplier_product_code: code, is_physical_override: true },
    };
    if (ownAction === AuditAction.UPDATE) ownMapping.before = { is_physical_override: ownWasOverride };
    const zeroedConfigs: AuditAffectedEntity[] = owners.productConfigs.map((pc) => ({
      entity: AuditEntity.PRODUCT_CONFIG,
      internal_id: pc.id,
      action: AuditAction.UPDATE,
      label: `do produto "${(pc as any).product?.name ?? pc.product_id}" na loja ${(pc as any).unitBusiness?.name ?? pc.unit_business_id}`,
      before: { gtin: pc.gtin },
      after: { gtin: null },
    }));
    const deletedMappings: AuditAffectedEntity[] = owners.supplierMappings.map((sm) => ({
      entity: AuditEntity.SUPPLIER_MAPPING,
      internal_id: sm.id,
      action: AuditAction.DELETE,
      label: `do produto "${sm.product?.name ?? sm.product_id}"`,
      before: { supplier_product_code: sm.supplier_product_code },
      after: null,
    }));
    const affected = [ownMapping, ...zeroedConfigs, ...deletedMappings];

    const scanNote = closedScanRows ? ` ${closedScanRows} registro(s) com foto desse EAN foram fechados.` : "";
    const entries: AuditLogEntry[] = [
      {
        userId,
        entity: AuditEntity.PRODUCT,
        internalId: productId,
        action: AuditAction.UPDATE,
        changes: {
          summary: `EAN ${code} confirmado como EAN físico deste produto (exclusivo na integração ${integrationName}).${scanNote}`,
          affected,
        },
      },
      ...affected.map((item) => ({
        userId,
        entity: item.entity,
        internalId: item.internal_id,
        action: item.action,
        changes: { summary: `EAN ${code} confirmado como EAN físico`, before: item.before, after: item.after, origin },
      })),
    ];

    // Log de cada produto que perdeu o EAN, com só o que mudou nele.
    const loserIds = [...new Set([...owners.productConfigs, ...owners.supplierMappings].map((row) => row.product_id))];
    for (const loserId of loserIds) {
      entries.push({
        userId,
        entity: AuditEntity.PRODUCT,
        internalId: loserId,
        action: AuditAction.UPDATE,
        changes: {
          summary: `Perdeu o EAN ${code}: ele foi confirmado como EAN físico do produto "${productName}"`,
          affected: [...zeroedConfigs, ...deletedMappings].filter((item) =>
            [...owners.productConfigs, ...owners.supplierMappings].some(
              (row) => row.id === item.internal_id && row.product_id === loserId,
            ),
          ),
          origin,
        },
      });
    }

    return entries;
  }

  // Relatório de pendências de integração (só leitura, lista completa, sem paginação): EAN físico confirmado que o ERP ainda
  // manda pra outros ("overrides"), mesmo EAN em 2+ produtos no ERP ("erp_duplicates"), sem EAN no ERP ("missing_ean"), não mapeado ("unmapped").
  async getIntegrationPendingReport(
    integrationsId: string,
    section: IntegrationPendingSection,
  ): Promise<unknown[]> {
    if (section === "unmapped") {
      return unmappedInvoiceProductService.findPendingByIntegration(integrationsId);
    }

    // Produto com configuração numa loja da integração mas sem EAN vindo do ERP, agrupado por produto.
    if (section === "missing_ean") {
      const configs = await productConfigService.findMissingErpEanInIntegration(integrationsId);
      type MissingEanRow = { product_id: string; product_name: string | null; unit_businesses: string[] };
      const byProduct = new Map<string, MissingEanRow>();
      for (const pc of configs) {
        const entry: MissingEanRow = byProduct.get(pc.product_id) ?? {
          product_id: pc.product_id,
          product_name: (pc as any).product?.name ?? null,
          unit_businesses: [],
        };
        const storeName = (pc as any).unitBusiness?.name;
        if (storeName && !entry.unit_businesses.includes(storeName)) entry.unit_businesses.push(storeName);
        byProduct.set(pc.product_id, entry);
      }
      return [...byProduct.values()];
    }

    const [erpConfigs, nonPrimaryEans, overrides] = await Promise.all([
      productConfigService.findErpEansInIntegration(integrationsId),
      integrationMappingService.findNonPrimaryErpEans(integrationsId),
      this.repository.findPhysicalOverridesInIntegration(integrationsId),
    ]);

    // O que o ERP diz, agrupado pelo EAN ignorando zero à esquerda.
    const claimsByKey = new Map<string, ErpEanClaim[]>();
    const addClaim = (claim: ErpEanClaim) => {
      const key = eanZeroInsensitiveKey(claim.ean);
      claimsByKey.set(key, [...(claimsByKey.get(key) ?? []), claim]);
    };
    erpConfigs.forEach((pc) =>
      addClaim({
        product_id: pc.product_id,
        product_name: (pc as any).product?.name ?? null,
        ean: pc.gtin_erp as string,
        source: "ERP_PRIMARY",
        unit_business: (pc as any).unitBusiness?.name ?? null,
      }),
    );
    nonPrimaryEans.forEach((m) =>
      addClaim({ product_id: m.product_id, product_name: m.product_name, ean: m.ean, source: "ERP_NON_PRIMARY", unit_business: null }),
    );

    if (section === "overrides") {
      const authors = await auditLogService.findLatestAuthors(
        AuditEntity.SUPPLIER_MAPPING,
        overrides.map((o) => o.id),
      );
      return overrides
        .map((o) => ({
          ean: o.supplier_product_code,
          owner: { product_id: o.product_id, product_name: o.product?.name ?? null },
          defined_by: authors.get(o.id) ?? null,
          replaced: this.groupClaimsByProduct(
            (claimsByKey.get(eanZeroInsensitiveKey(o.supplier_product_code)) ?? []).filter(
              (claim) => claim.product_id !== o.product_id,
            ),
          ),
        }))
        .filter((row) => row.replaced.length);
    }

    const groups = [...claimsByKey.entries()]
      .filter(([, claims]) => new Set(claims.map((c) => c.product_id)).size > 1)
      .sort(([a], [b]) => a.localeCompare(b));

    // Quem prevalece em cada grupo — duas queries pra todos os grupos.
    const codes = [...new Set(groups.flatMap(([, claims]) => claims.flatMap((c) => buildEanZeroVariants(c.ean))))];
    let gtinOwners: ProductConfig[] = [];
    let mappingOwners: SupplierMapping[] = [];
    if (codes.length) {
      [gtinOwners, mappingOwners] = await Promise.all([
        productConfigService.findGtinOwnersInIntegration(codes, integrationsId, null),
        this.repository.findCodeOwnersInIntegration(codes, integrationsId, null),
      ]);
    }

    const toProducts = (rows: Array<{ product_id: string; product_name: string | null }>) => [
      ...new Map(rows.map((r) => [r.product_id, r])).values(),
    ];
    return groups.map(([key, claims]) => {
      const override = overrides.find((o) => eanZeroInsensitiveKey(o.supplier_product_code) === key);
      const localGtin = gtinOwners.filter((pc) => eanZeroInsensitiveKey(pc.gtin as string) === key);
      const mapping = mappingOwners.filter((sm) => eanZeroInsensitiveKey(sm.supplier_product_code) === key);

      // Ordem de quem prevalece: EAN físico confirmado → EAN gravado no produto → DE x PARA → ninguém.
      let prevailing: ErpEanPrevailing = { rule: "NONE", products: [] };
      if (override) {
        prevailing = {
          rule: "PHYSICAL_OVERRIDE",
          products: [{ product_id: override.product_id, product_name: override.product?.name ?? null }],
        };
      } else if (localGtin.length) {
        prevailing = {
          rule: "LOCAL_GTIN",
          products: toProducts(
            localGtin.map((pc) => ({ product_id: pc.product_id, product_name: (pc as any).product?.name ?? null })),
          ),
        };
      } else if (mapping.length) {
        prevailing = {
          rule: "SUPPLIER_MAPPING",
          products: toProducts(
            mapping.map((sm) => ({ product_id: sm.product_id, product_name: sm.product?.name ?? null })),
          ),
        };
      }

      return { ean: key, products: this.groupClaimsByProduct(claims), prevailing };
    });
  }

  // Junta as linhas do ERP por produto (EANs, origens e lojas sem repetição) pra exibição no relatório.
  private groupClaimsByProduct(
    claims: ErpEanClaim[],
  ): ErpEanClaimProduct[] {
    const byProduct = new Map<string, ErpEanClaimProduct>();
    for (const claim of claims) {
      const entry = byProduct.get(claim.product_id) ?? {
        product_id: claim.product_id,
        product_name: claim.product_name,
        eans: [],
        sources: [],
        unit_businesses: [],
      };
      if (!entry.eans.includes(claim.ean)) entry.eans.push(claim.ean);
      if (!entry.sources.includes(claim.source)) entry.sources.push(claim.source);
      if (claim.unit_business && !entry.unit_businesses.includes(claim.unit_business)) {
        entry.unit_businesses.push(claim.unit_business);
      }
      byProduct.set(claim.product_id, entry);
    }
    return [...byProduct.values()];
  }

  // Lista paginada dos SupplierMappings de um produto, escopada na integração do usuário; productId obrigatório.
  findByProductId(
    params: QueryParams,
    productId: string,
    integrationsId: string,
  ): Promise<PaginatedResult<SupplierMapping>> {
    if (!productId) {
      throw new Error("product_id não informado");
    }

    return this.repository.findPaginated(
      params,
      this.queryConfig,
      {
        include: [
          {
            model: Integration,
            as: "integration",
            attributes: ["id", "name"],
          },
        ],
      },
      {
        product_id: productId,
        integrations_id: integrationsId,
      },
    );
  }

  // Cria SupplierMapping pro produto da rota na integração do usuário. Antes, checa com code pro front: produto sem
  // vínculo na integração, EAN físico confirmado pra outro produto, ou EAN (com zero à esquerda) já usado por outro.
  async createForProduct(
    productId: string,
    integrationsId: string,
    data: ProductSupplierMappingInput,
    userId?: string | null,
  ): Promise<SupplierMapping> {
    await this.assertProductMappedInIntegration(productId, integrationsId);

    const code = data.supplier_product_code?.trim();
    if (code) await this.assertEanFreeForProduct(code, integrationsId, productId);

    try {
      return await sequelize.transaction(async (t) => {
        const record = await this.create(
          {
            product_id: productId,
            integrations_id: integrationsId,
            supplier_product_code: data.supplier_product_code,
            supplier_cnpj: data.supplier_cnpj,
          },
          { transaction: t },
        );

        const closedScanRows = code
          ? await unmappedInvoiceProductService.closeScanRowsByEan(buildEanZeroVariants(code), integrationsId, t)
          : 0;

        // Entrada do DE x PARA + entrada do produto (histórico do produto mostra o vínculo).
        const summary = `Código ${record.supplier_product_code} vinculado ao produto${closedScanRows ? `; ${closedScanRows} registro(s) com foto desse EAN foram fechados` : ""}`;
        const after = { supplier_product_code: record.supplier_product_code, product_id: productId };
        await auditLogService.record(
          [
            {
              userId,
              entity: AuditEntity.SUPPLIER_MAPPING,
              internalId: record.id,
              action: AuditAction.CREATE,
              changes: { summary, after, origin: { entity: AuditEntity.PRODUCT, internal_id: productId } },
            },
            {
              userId,
              entity: AuditEntity.PRODUCT,
              internalId: productId,
              action: AuditAction.UPDATE,
              changes: {
                summary,
                affected: [
                  { entity: AuditEntity.SUPPLIER_MAPPING, internal_id: record.id, action: AuditAction.CREATE, before: null, after },
                ],
              },
            },
          ],
          t,
        );

        return record;
      });
    } catch (error: any) {
      // FK de product_id = produto inexistente (não dá pra checar via productService: import circular).
      if (error instanceof ForeignKeyConstraintError) {
        throw new Error("Produto não encontrado");
      }
      throw error;
    }
  }

  // Atualiza código/CNPJ de um SupplierMapping do produto na integração do usuário; null = não pertence/não existe.
  // `is_physical_override: false` desativa o EAN físico confirmado (só admin/developer, auditado): volta a ser DE x PARA comum.
  async updateForProduct(
    id: string,
    productId: string,
    integrationsId: string,
    data: Partial<ProductSupplierMappingInput>,
    canManageOverride?: boolean,
    userId: string | null = null,
  ): Promise<SupplierMapping | null> {
    const existing = await this.findOne({
      where: { id, product_id: productId, integrations_id: integrationsId },
      attributes: ["id", "supplier_product_code", "is_physical_override"],
    });
    if (!existing) return null;
    if (existing.is_physical_override) this.assertCanManageOverride(canManageOverride);

    // Confirmar só pela rota própria (permissão + limpeza dos outros produtos); aqui só desativa.
    if (data.is_physical_override === true) {
      throw new Error('Para confirmar o EAN físico use a opção "Confirmar EAN físico"');
    }

    if (
      data.supplier_product_code !== undefined &&
      !data.supplier_product_code
    ) {
      throw new Error("supplier_product_code não informado");
    }
    if (data.supplier_product_code) {
      await this.assertEanFreeForProduct(data.supplier_product_code, integrationsId, productId);
    }

    // Só manda o que veio no body, pra não zerar campo omitido.
    const changes: Partial<ProductSupplierMappingInput> = {};
    if (data.supplier_product_code !== undefined)
      changes.supplier_product_code = data.supplier_product_code;
    if (data.supplier_cnpj !== undefined)
      changes.supplier_cnpj = data.supplier_cnpj;
    const deactivatingOverride = data.is_physical_override === false && existing.is_physical_override;
    if (deactivatingOverride) changes.is_physical_override = false;

    try {
      return await sequelize.transaction(async (t) => {
        // repository.update (instância) em vez de bulkUpdate pra rodar o hook beforeUpdate que limpa o CNPJ.
        const updated = await this.repository.update(id, changes, { transaction: t });

        if (deactivatingOverride) {
          const code = changes.supplier_product_code ?? existing.supplier_product_code;
          await auditLogService.record(
            [AuditEntity.SUPPLIER_MAPPING, AuditEntity.PRODUCT].map((entity) => ({
              userId,
              entity,
              internalId: entity === AuditEntity.PRODUCT ? productId : id,
              action: AuditAction.UPDATE,
              changes: {
                summary: `EAN ${code} deixou de ser o EAN físico confirmado deste produto e voltou a ser um mapeamento DE x PARA comum; a próxima sincronização pode voltar o EAN do ERP para os outros produtos`,
                before: { supplier_product_code: existing.supplier_product_code, is_physical_override: true },
                after: { supplier_product_code: code, is_physical_override: false },
              },
            })),
            t,
          );
        }
        return updated;
      });
    } catch (error: any) {
      if (error instanceof UniqueConstraintError) {
        throw new Error(
          `Já existe um SupplierMapping com o código ${changes.supplier_product_code} nessa integração`,
        );
      }
      throw error;
    }
  }

  // Remove um SupplierMapping do produto na integração do usuário; false = não pertence/não existe.
  // EAN físico confirmado só sai com admin/developer (canManageOverride) e a remoção é auditada.
  async deleteForProduct(
    id: string,
    productId: string,
    integrationsId: string,
    opts: { userId?: string | null; canManageOverride?: boolean } = {},
  ): Promise<boolean> {
    return sequelize.transaction(async (t) => {
      const existing = await this.repository.findOne({
        where: { id, product_id: productId, integrations_id: integrationsId },
        attributes: ["id", "supplier_product_code", "is_physical_override"],
        transaction: t,
      });
      if (!existing) return false;

      if (existing.is_physical_override) {
        this.assertCanManageOverride(opts.canManageOverride);
        await auditLogService.record(
          [AuditEntity.SUPPLIER_MAPPING, AuditEntity.PRODUCT].map((entity) => ({
            userId: opts.userId ?? null,
            entity,
            internalId: entity === AuditEntity.PRODUCT ? productId : id,
            action: entity === AuditEntity.PRODUCT ? AuditAction.UPDATE : AuditAction.DELETE,
            changes: {
              summary: `EAN ${existing.supplier_product_code} deixou de ser o EAN físico confirmado deste produto; a próxima sincronização volta o EAN do ERP para os outros produtos`,
              before: { supplier_product_code: existing.supplier_product_code, is_physical_override: true },
              after: null,
            },
          })),
          t,
        );
      }

      await this.repository.bulkDelete({ where: { id }, transaction: t });
      return true;
    });
  }

  // Só admin/developer mexe em EAN físico confirmado (senão o "override não derruba override" vira apagar e recriar).
  assertCanManageOverride(canManageOverride?: boolean): void {
    if (!canManageOverride) {
      throw new Error(
        "Somente administradores podem alterar ou remover um EAN físico confirmado",
      );
    }
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
    userId?: string | null;
  }): Promise<SupplierMapping | null> {
    return sequelize.transaction(async (t) => {
      const unmapped = await unmappedInvoiceProductService.findById(
        params.unmappedInvoiceProductId,
        { transaction: t },
      );

      if (!unmapped) {
        throw new Error("Produto não mapeado não encontrado!");
      }

      // ERROR_CATALOG_DUPLICATE: o código é ambíguo por definição (colide
      // com outro produto no catálogo Tecinco) — não faz sentido tentar
      // criar um SupplierMapping pra ele (a validação de conflito
      // bloquearia mesmo). Só cria o integration_mapping (produto Tecinco
      // × produto sistema via external_id, que é sempre único
      // independente da ambiguidade de sku/ean) e apaga o unmapped.
      if (unmapped.type === "ERROR_CATALOG_DUPLICATE") {
        if (!unmapped.integrations_id || !unmapped.external_id) {
          throw new Error(
            "Produto não mapeado duplicado sem integrations_id/external_id, não é possível mapear",
          );
        }
        await integrationMappingService.createOrUpdateIntegrationMapping(
          {
            entity_type: "PRODUCT",
            internal_id: params.productId,
            integrations_id: unmapped.integrations_id,
            external_id: unmapped.external_id,
          },
          t,
        );
        await unmappedInvoiceProductService.delete(unmapped.id, {
          transaction: t,
        });
        return null;
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

      // Mesmo pré-check do createForProduct, com zero à esquerda: protege EAN físico confirmado de outro produto
      // e devolve erro com code em vez da violação de unique/trigger.
      await this.assertEanFreeForProduct(supplierProductCode, unmapped.integrations_id, params.productId, t);

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

      // Mapeamento feito por uma pessoa a partir do não mapeado: o código sempre vira EAN físico confirmado do
      // produto (is_physical_override) — o sync deixa de gravar esse EAN em outros produtos. Auditado abaixo.
      let supplierMapping: SupplierMapping;
      let auditAction = AuditAction.CREATE;
      if (existingMapping) {
        if (existingMapping.product_id !== params.productId) {
          throw new Error(
            `Já existe um SupplierMapping com o código ${supplierProductCode} nessa integração, mapeado para outro produto (id=${existingMapping.product_id})`,
          );
        }
        if (!existingMapping.is_physical_override) {
          await this.repository.bulkUpdate(
            { is_physical_override: true },
            { where: { id: existingMapping.id }, transaction: t },
          );
          existingMapping.is_physical_override = true;
        }
        supplierMapping = existingMapping;
        auditAction = AuditAction.UPDATE;
      } else {
        supplierMapping = await this.create(
          {
            product_id: params.productId,
            supplier_cnpj: params.supplierCnpj,
            supplier_product_code: supplierProductCode,
            integrations_id: unmapped.integrations_id,
            is_physical_override: true,
          },
          { transaction: t },
        );
      }

      // Quem/quando do EAN físico confirmado (usado no erro EAN_HAS_PHYSICAL_OVERRIDE e no relatório de pendências).
      await auditLogService.record(
        [AuditEntity.SUPPLIER_MAPPING, AuditEntity.PRODUCT].map((entity) => ({
          userId: params.userId ?? null,
          entity,
          internalId: entity === AuditEntity.PRODUCT ? params.productId : supplierMapping.id,
          action: entity === AuditEntity.PRODUCT ? AuditAction.UPDATE : auditAction,
          changes: {
            summary: `EAN ${supplierProductCode} confirmado como EAN físico do produto ao mapear um produto não mapeado`,
            after: { supplier_product_code: supplierProductCode, is_physical_override: true },
          },
        })),
        t,
      );

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
