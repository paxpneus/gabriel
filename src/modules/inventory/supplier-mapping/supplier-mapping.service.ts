import {
  ConnectionError,
  CreateOptions,
  ForeignKeyConstraintError,
  Op,
  TimeoutError,
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
  IntegrationPendingIntegration,
  FullSupplierMapping,
  ProductSupplierMappingInput,
  SupplierMappingError,
  SupplierMappingErrorCode,
  SupplierMappingCreationAttributes,
  CreateFromUnmappedResult,
  SYNC_SUPPLIER_CNPJ_PREFIX,
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
import { cleanDocument } from "../../../shared/utils/normalizers/document";
import { isValidCNPJ } from "../../../shared/utils/validators/document";
import unmappedInvoiceProductService from "../unmapped-invoice-product/unmapped-invoice-product.service";
// Ciclo com product.service (que importa este service): seguro porque só é usado dentro dos métodos, nunca no load.
import productService from "../products/services/product.service";
import integrationMappingService from "../../integrations/integration-mapping/integration-mapping.service";
import {
  UNMAPPED_REASON_INVOICE_PRODUCT_NOT_IN_DB,
  UNMAPPED_REASON_NEW_CATALOG_PRODUCT,
} from "../unmapped-invoice-product/unmapped-invoice-product.types";
import {
  QueryParams,
  PaginatedResult,
} from "../../../shared/query/query.types";
import Integration from "../../integrations/integrations/integrations.model";
import integrationsService from "../../integrations/integrations/integrations.service";
import type { ErpCodeRow } from "../../integrations/integration-mapping/integration-mapping.types";
import auditLogService from "../../global/audit-logs/audit-log.service";
import {
  AuditAction,
  AuditAffectedEntity,
  AuditEntity,
  AuditLogEntry,
} from "../../global/audit-logs/audit-log.types";
import userService from "../../company/users/users/user.service";
import { PHYSICAL_EAN_OWNER_ENTITY } from "../../../shared/constants/roles";
import { FULL_ACCESS_USER_TYPES } from "../../../shared/constants/user-types";

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
  async assertProductMappedInIntegration(
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
      `O EAN ${code} já está em uso por: ${names}.`,
      summary,
    );
  }

  // Usuário pode "Confirmar EAN físico": admin/developer ou papel com a permissão (mesma regra do userPermissions).
  async canConfirmPhysicalOwner(token?: string): Promise<boolean> {
    if (!token) return false;
    const user: any = await userService.getMe(token);
    if (FULL_ACCESS_USER_TYPES.includes(user?.type ?? user?.config?.type)) return true;
    // Não importa userHasPermission: o middleware puxa config/routes (todos os módulos). Entidade de topo, sem children.
    return (user?.role?.permissions ?? []).some(
      (perm: any) => perm === "*" || (perm.entity === PHYSICAL_EAN_OWNER_ENTITY && perm.permissions?.includes("write")),
    );
  }

  // Corpo do 400 de SupplierMappingError: no EAN em uso, o back decide se oferece "Confirmar EAN físico" ou foto
  // (can_confirm_physical_owner + mensagem final) — o front só exibe.
  async buildErrorResponse(error: SupplierMappingError, token?: string) {
    const canConfirm =
      error.code === SupplierMappingErrorCode.EAN_OWNED_BY_ANOTHER_PRODUCT && (await this.canConfirmPhysicalOwner(token));
    let message = error.message;
    if (error.code === SupplierMappingErrorCode.EAN_OWNED_BY_ANOTHER_PRODUCT) {
      const hint = canConfirm
        ? 'Se o produto bipado é este, use "Confirmar EAN físico".'
        : "Você não tem permissão para confirmar o EAN físico. Tire uma foto para registrar o produto.";
      message = `${message} ${hint}`;
    }
    return {
      error: message,
      code: error.code,
      owners: error.owners,
      override: error.override,
      can_confirm_physical_owner: canConfirm,
    };
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

  // Código do DE x PARA como o bipe compara: string sem espaços nas pontas; vazio é erro (nunca grava "" nem "  ").
  normalizeSupplierCode(value: unknown): string {
    const code = value === null || value === undefined ? "" : String(value).trim();
    if (!code) throw new Error("Informe o código do produto (EAN ou código do fornecedor)");
    return code;
  }

  // CNPJ do fornecedor opcional: só dígitos e válido quando vier — vazio vira null. `current` = valor gravado: a tela
  // devolve a marca do sync (`PENDING-<id>`) só com os dígitos, e aí a marca é mantida em vez de virar CNPJ inválido.
  normalizeSupplierCnpj(value: unknown, current?: string | null): string | null {
    const digits = value === null || value === undefined ? "" : cleanDocument(String(value));
    if (!digits) return null;
    if (current?.startsWith(SYNC_SUPPLIER_CNPJ_PREFIX) && digits === cleanDocument(current)) return current;
    if (!isValidCNPJ(digits)) throw new Error("CNPJ do fornecedor inválido");
    return digits;
  }

  // Serializa, na transação, escritas do mesmo EAN (ignorando zero à esquerda) na integração: sem isso, duas
  // confirmações simultâneas de variações diferentes passavam pela checagem e viravam 2 overrides.
  private async lockEanInIntegration(code: string, integrationsId: string, transaction: Transaction): Promise<void> {
    await sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:key))", {
      replacements: { key: `supplier-mapping-ean:${integrationsId}:${eanZeroInsensitiveKey(code)}` },
      transaction,
    });
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
    // String(): EAN numérico no JSON não pode quebrar com "trim is not a function".
    const code = normalizeEan(params.ean === null || params.ean === undefined ? undefined : String(params.ean));
    if (!code) throw new Error("Informe o EAN bipado");

    const integration = await integrationsService.findById(integrationsId, { attributes: ["id", "name"] });
    if (!integration) throw new Error("Integração não encontrada");

    await this.assertProductMappedInIntegration(productId, integrationsId);

    return sequelize.transaction(async (t) => {
      await this.lockEanInIntegration(code, integrationsId, t);
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

      // Depois da limpeza, o EAN (e as variações de zero) só pode estar no próprio produto: reaproveita o código exato,
      // ou o override dele numa variação (vira o código bipado — nunca 2 overrides do mesmo EAN); senão cria.
      const ownRows = await this.repository.findAll({
        where: {
          integrations_id: integrationsId,
          product_id: productId,
          supplier_product_code: { [Op.in]: buildEanZeroVariants(code) },
        },
        attributes: ["id", "supplier_product_code", "is_physical_override"],
        transaction: t,
      });
      const own =
        ownRows.find((row) => row.supplier_product_code === code) ??
        ownRows.find((row) => row.is_physical_override) ??
        null;
      const ownAction = own ? AuditAction.UPDATE : AuditAction.CREATE;
      if (own) {
        await this.repository.bulkUpdate(
          { is_physical_override: true, supplier_product_code: code },
          { where: { id: own.id }, transaction: t },
        );
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
          ownPreviousCode: own?.supplier_product_code ?? null,
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
    ownPreviousCode: string | null;
    owners: EanOwners;
    closedScanRows: number;
  }): AuditLogEntry[] {
    const { productId, productName, code, integrationName, userId, supplierMappingId, ownAction, ownWasOverride, ownPreviousCode, owners, closedScanRows } = params;
    const origin = { entity: AuditEntity.PRODUCT, internal_id: productId, label: `"${productName}"` };

    const ownMapping: AuditAffectedEntity = {
      entity: AuditEntity.SUPPLIER_MAPPING,
      internal_id: supplierMappingId,
      action: ownAction,
      label: `com o código "${code}"`,
      before: null,
      after: { supplier_product_code: code, is_physical_override: true },
    };
    if (ownAction === AuditAction.UPDATE) {
      ownMapping.before = { supplier_product_code: ownPreviousCode ?? code, is_physical_override: ownWasOverride };
    }
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
  // manda pra outros ("overrides"), produto com 2+ códigos no ERP ("erp_duplicates"), mesmo EAN/SKU em 2+ produtos no ERP
  // ("erp_ean_duplicates"/"erp_sku_duplicates"), sem EAN no ERP ("missing_ean"), não mapeado ("unmapped").
  async getIntegrationPendingReport(
    integrationsId: string,
    section: IntegrationPendingSection,
  ): Promise<unknown[]> {
    if (section === "unmapped") {
      return unmappedInvoiceProductService.findPendingByIntegration(integrationsId);
    }

    // Integração da linha (EAN do ERP é do cadastro da integração, vale pra todas as lojas dela — não lista loja).
    const found = await integrationsService.findById(integrationsId, { attributes: ["id", "name"] });
    const integration: IntegrationPendingIntegration = { id: integrationsId, name: found?.name ?? "" };

    // Mesmo produto com 2+ códigos no ERP (cadastro duplicado no ERP), ordenado por nome.
    if (section === "erp_duplicates") {
      const products = await integrationMappingService.findProductsWithMultipleCodes(integrationsId);
      return products
        .map((product) => ({ ...product, integration }))
        .sort((x, y) => (x.product_name ?? "").localeCompare(y.product_name ?? ""));
    }

    // Linha do erp_data de um mapping (principal ou não) como claim do relatório.
    const toClaim = (row: ErpCodeRow): ErpEanClaim => ({
      product_id: row.product_id,
      product_name: row.product_name,
      code: row.code,
      external_id: row.external_id,
      source: row.is_primary ? "ERP_PRIMARY" : "ERP_NON_PRIMARY",
    });

    // Código no ERP já sincronizado que não manda EAN (principal ou não), uma linha por produto com os códigos sem EAN.
    if (section === "missing_ean") {
      const rows = await integrationMappingService.findErpCodesInIntegration(integrationsId, "ean", true);
      return this.groupClaimsByProduct(rows.map(toClaim), integration)
        .map(({ eans, ...product }) => product)
        .sort((x, y) => (x.product_name ?? "").localeCompare(y.product_name ?? ""));
    }

    // Mesmo SKU (exato) em 2+ produtos, olhando o erp_data de todos os códigos — não só o principal da config.
    if (section === "erp_sku_duplicates") {
      const rows = await integrationMappingService.findErpCodesInIntegration(integrationsId, "sku");
      const bySku = new Map<string, ErpEanClaim[]>();
      rows.forEach((row) => bySku.set(row.code as string, [...(bySku.get(row.code as string) ?? []), toClaim(row)]));
      return [...bySku.entries()]
        .filter(([, claims]) => new Set(claims.map((c) => c.product_id)).size > 1)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([sku, claims]) => ({
          sku,
          // SKU é o mesmo em todas as linhas — sem a lista de códigos que o EAN usa.
          products: this.groupClaimsByProduct(claims, integration).map(({ eans, ...product }) => product),
        }));
    }

    const [erpEans, overrides] = await Promise.all([
      integrationMappingService.findErpCodesInIntegration(integrationsId, "ean"),
      this.repository.findPhysicalOverridesInIntegration(integrationsId),
    ]);

    // O que o ERP diz (erp_data de todos os códigos), agrupado pelo EAN ignorando zero à esquerda.
    const claimsByKey = new Map<string, ErpEanClaim[]>();
    erpEans.forEach((row) => {
      const key = eanZeroInsensitiveKey(row.code as string);
      claimsByKey.set(key, [...(claimsByKey.get(key) ?? []), toClaim(row)]);
    });

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
            integration,
          ),
        }))
        .filter((row) => row.replaced.length);
    }

    // "erp_ean_duplicates": mesmo EAN (ignorando zero) em 2+ produtos diferentes.
    const groups = [...claimsByKey.entries()]
      .filter(([, claims]) => new Set(claims.map((c) => c.product_id)).size > 1)
      .sort(([a], [b]) => a.localeCompare(b));

    // Quem prevalece em cada grupo — duas queries pra todos os grupos.
    const codes = [...new Set(groups.flatMap(([, claims]) => claims.flatMap((c) => buildEanZeroVariants(c.code as string))))];
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

      return { ean: key, products: this.groupClaimsByProduct(claims, integration), prevailing };
    });
  }

  // Junta as linhas do ERP por produto (EANs, códigos no ERP e origens sem repetição) com a integração, pra exibição no relatório.
  private groupClaimsByProduct(
    claims: ErpEanClaim[],
    integration: IntegrationPendingIntegration,
  ): ErpEanClaimProduct[] {
    const byProduct = new Map<string, ErpEanClaimProduct>();
    for (const claim of claims) {
      const entry = byProduct.get(claim.product_id) ?? {
        product_id: claim.product_id,
        product_name: claim.product_name,
        eans: [],
        external_ids: [],
        sources: [],
        integration,
      };
      if (claim.code && !entry.eans.includes(claim.code)) entry.eans.push(claim.code);
      if (!entry.external_ids.includes(claim.external_id)) entry.external_ids.push(claim.external_id);
      if (!entry.sources.includes(claim.source)) entry.sources.push(claim.source);
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

    const code = this.normalizeSupplierCode(data.supplier_product_code);
    const supplierCnpj = this.normalizeSupplierCnpj(data.supplier_cnpj);

    try {
      return await sequelize.transaction(async (t) => {
        await this.lockEanInIntegration(code, integrationsId, t);
        await this.assertEanFreeForProduct(code, integrationsId, productId, t);

        const record = await this.create(
          {
            product_id: productId,
            integrations_id: integrationsId,
            supplier_product_code: code,
            supplier_cnpj: supplierCnpj ?? undefined,
          },
          { transaction: t },
        );

        const closedScanRows = await unmappedInvoiceProductService.closeScanRowsByEan(
          buildEanZeroVariants(code),
          integrationsId,
          t,
        );

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
      attributes: ["id", "supplier_product_code", "supplier_cnpj", "is_physical_override"],
    });
    if (!existing) return null;
    if (existing.is_physical_override) this.assertCanManageOverride(canManageOverride);

    // Confirmar só pela rota própria (permissão + limpeza dos outros produtos); aqui só desativa.
    if (data.is_physical_override === true) {
      throw new Error('Para confirmar o EAN físico use a opção "Confirmar EAN físico"');
    }

    // Só manda o que veio no body, pra não zerar campo omitido.
    const changes: Partial<ProductSupplierMappingInput> = {};
    if (data.supplier_product_code !== undefined) {
      changes.supplier_product_code = this.normalizeSupplierCode(data.supplier_product_code);
    }
    if (data.supplier_cnpj !== undefined) {
      changes.supplier_cnpj = this.normalizeSupplierCnpj(data.supplier_cnpj, existing.supplier_cnpj) as string;
    }
    const deactivatingOverride = data.is_physical_override === false && existing.is_physical_override;
    if (deactivatingOverride) changes.is_physical_override = false;

    try {
      return await sequelize.transaction(async (t) => {
        if (changes.supplier_product_code) {
          await this.lockEanInIntegration(changes.supplier_product_code, integrationsId, t);
          await this.assertEanFreeForProduct(changes.supplier_product_code, integrationsId, productId, t);
        }

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

  // Vincula um não mapeado a um produto JÁ EXISTENTE (sem passar por InvoiceItems). Produto já mapeado na integração:
  // DE x PARA com o código do não mapeado (EAN físico confirmado) + mapping do external_id; erro do DE x PARA propaga.
  // Produto sem mapping na integração: só ERROR_CATALOG de produto do ERP sem cadastro, com external_id — cria o mapping,
  // tenta o DE x PARA (falha só não cria) e resolve as linhas desse external_id (inclusive as de nota).
  async createFromUnmapped(params: {
    productId: string;
    unmappedInvoiceProductId: string;
    supplierCnpj?: string;
    userId?: string | null;
  }): Promise<CreateFromUnmappedResult> {
    const unmapped = await unmappedInvoiceProductService.findById(params.unmappedInvoiceProductId);
    if (!unmapped) {
      throw new Error("Produto não mapeado não encontrado!");
    }
    if (unmapped.status !== "UNMAPPED") {
      throw new Error("Esse produto não mapeado já foi resolvido");
    }
    // internal_id do mapping não é FK: sem essa checagem, um produto inexistente viraria mapping órfão prendendo o código.
    const product = await productService.findById(params.productId, { attributes: ["id"] });
    if (!product) {
      throw new Error("Produto não encontrado");
    }
    if (!unmapped.integrations_id) {
      throw new Error(
        "Produto não mapeado sem integração associada, não é possível criar o DE X PARA",
      );
    }
    const integrationsId = unmapped.integrations_id;
    const supplierCnpj = this.normalizeSupplierCnpj(params.supplierCnpj) ?? undefined;

    const [integration, mappedIds] = await Promise.all([
      integrationsService.findById(integrationsId, { attributes: ["id", "name"] }),
      integrationMappingService.findExternalIdsMap("PRODUCT", integrationsId, [params.productId]),
    ]);
    if (!integration) throw new Error("Integração não encontrada");

    // ERROR_CATALOG_DUPLICATE: código ambíguo no catálogo Tecinco — só cria o integration_mapping, nunca o DE x PARA.
    const isDuplicate = unmapped.type === "ERROR_CATALOG_DUPLICATE";
    if (isDuplicate && !unmapped.external_id) {
      throw new Error(
        "Produto não mapeado duplicado sem integrations_id/external_id, não é possível mapear",
      );
    }

    // Produto sem mapping na integração: o vínculo nasce do external_id, então só pra produto do ERP sem cadastro.
    const linksProduct = !isDuplicate && !mappedIds.has(params.productId);
    if (linksProduct) {
      const linkableReason =
        unmapped.type === "ERROR_CATALOG" &&
        [UNMAPPED_REASON_NEW_CATALOG_PRODUCT, UNMAPPED_REASON_INVOICE_PRODUCT_NOT_IN_DB].includes(unmapped.reason);
      const howToFix = `Vincule o produto ao ${integration.name} em "Mapeamento de integração", na tela do produto, e tente de novo.`;
      let message = "";
      if (!linkableReason) {
        message = `O produto escolhido ainda não está vinculado ao ${integration.name}. O vínculo automático só é feito a partir de um produto novo do ${integration.name} ou de um produto da nota sem cadastro no sistema. ${howToFix}`;
      } else if (!unmapped.external_id) {
        message = `O produto escolhido ainda não está vinculado ao ${integration.name}, e este produto pendente não tem o código do ${integration.name} para fazer o vínculo. ${howToFix}`;
      }
      if (message) {
        throw new SupplierMappingError(SupplierMappingErrorCode.PRODUCT_NOT_MAPPED_IN_INTEGRATION, message);
      }
    }

    const { supplierMapping, integrationMapping } = await sequelize.transaction(async (t) => {
      let supplierMapping: SupplierMapping | null = null;
      if (!isDuplicate) {
        try {
          // Savepoint: no vínculo de produto sem mapping, falha do DE x PARA não pode abortar a transação inteira.
          supplierMapping = await sequelize.transaction({ transaction: t }, async (sp) => {
            const supplierProductCode = unmapped.ean ?? unmapped.sku;
            if (!supplierProductCode) {
              throw new Error(
                "Produto não mapeado sem EAN/SKU, não é possível criar o DE X PARA",
              );
            }

            // Mesmo pré-check do createForProduct, com zero à esquerda: protege EAN físico confirmado de outro produto
            // e devolve erro com code em vez da violação de unique/trigger.
            await this.lockEanInIntegration(supplierProductCode, integrationsId, sp);
            await this.assertEanFreeForProduct(supplierProductCode, integrationsId, params.productId, sp);

            // Código já mapeado pro MESMO produto é idempotente (não recria); pra outro produto é conflito.
            const existingMapping = await this.findOne({
              where: { integrations_id: integrationsId, supplier_product_code: supplierProductCode },
              transaction: sp,
            });

            // Mapeamento feito por uma pessoa a partir do não mapeado: o código sempre vira EAN físico confirmado do
            // produto (is_physical_override) — o sync deixa de gravar esse EAN em outros produtos. Auditado abaixo.
            let record: SupplierMapping;
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
                  { where: { id: existingMapping.id }, transaction: sp },
                );
                existingMapping.is_physical_override = true;
              }
              record = existingMapping;
              auditAction = AuditAction.UPDATE;
            } else {
              record = await this.create(
                {
                  product_id: params.productId,
                  supplier_cnpj: supplierCnpj,
                  supplier_product_code: supplierProductCode,
                  integrations_id: integrationsId,
                  is_physical_override: true,
                },
                { transaction: sp },
              );
            }

            // Quem/quando do EAN físico confirmado (usado no erro EAN_HAS_PHYSICAL_OVERRIDE e no relatório de pendências).
            await auditLogService.record(
              [AuditEntity.SUPPLIER_MAPPING, AuditEntity.PRODUCT].map((entity) => ({
                userId: params.userId ?? null,
                entity,
                internalId: entity === AuditEntity.PRODUCT ? params.productId : record.id,
                action: entity === AuditEntity.PRODUCT ? AuditAction.UPDATE : auditAction,
                changes: {
                  summary: `EAN ${supplierProductCode} confirmado como EAN físico do produto ao mapear um produto não mapeado`,
                  after: { supplier_product_code: supplierProductCode, is_physical_override: true },
                },
              })),
              sp,
            );

            return record;
          });
        } catch (error: any) {
          // Só regra/conflito de dado é engolido no vínculo novo; falha de infraestrutura derruba a operação.
          if (!linksProduct || error instanceof ConnectionError || error instanceof TimeoutError) throw error;
          console.warn(
            `[SUPPLIER_MAPPING] DE x PARA não criado ao vincular o não mapeado ${unmapped.id} ao produto ${params.productId}: ${error.message}`,
          );
        }
      }

      // external_id = id do produto no ERP: sem o mapping, o próximo sync (mapping-only) recriaria o não mapeado.
      // createOrUpdateIntegrationMapping nunca reaponta e decide o principal (primeiro da integração = principal).
      let integrationMapping: CreateFromUnmappedResult["integrationMapping"] = null;
      if (unmapped.external_id) {
        const mapping = await integrationMappingService.createOrUpdateIntegrationMapping(
          {
            entity_type: "PRODUCT",
            internal_id: params.productId,
            integrations_id: integrationsId,
            external_id: unmapped.external_id,
          },
          t,
        );
        if (mapping.internal_id === params.productId) {
          integrationMapping = { id: mapping.id, external_id: mapping.external_id, is_primary: !!mapping.is_primary };
        } else {
          // Código do ERP de outro produto: nunca reaponta nem fecha o não mapeado em silêncio (rollback de tudo).
          throw new Error(
            `O código ${unmapped.external_id} do ${integration.name} já está vinculado a outro produto no sistema. Encaminhe para o time técnico. [integration_mapping ${mapping.id}, produto ${mapping.internal_id}]`,
          );
        }
      }

      // Vínculo novo com a integração (produto sem mapping nela, ou código ambíguo do catálogo) entra no histórico.
      if ((linksProduct || isDuplicate) && integrationMapping) {
        const summary = `Produto vinculado ao código ${integrationMapping.external_id} do ${integration.name} ao mapear um produto não mapeado`;
        const after = { external_id: integrationMapping.external_id, is_primary: integrationMapping.is_primary };
        await auditLogService.record(
          [
            {
              userId: params.userId ?? null,
              entity: AuditEntity.INTEGRATION_MAPPING,
              internalId: integrationMapping.id,
              action: AuditAction.CREATE,
              changes: { summary, after, origin: { entity: AuditEntity.PRODUCT, internal_id: params.productId } },
            },
            {
              userId: params.userId ?? null,
              entity: AuditEntity.PRODUCT,
              internalId: params.productId,
              action: AuditAction.UPDATE,
              changes: {
                summary,
                affected: [
                  { entity: AuditEntity.INTEGRATION_MAPPING, internal_id: integrationMapping.id, action: AuditAction.CREATE, before: null, after },
                ],
              },
            },
          ],
          t,
        );
      }

      // Vínculo novo resolve depois do commit (todas as linhas do external_id); senão só a linha atual sai.
      if (!linksProduct) {
        await unmappedInvoiceProductService.delete(unmapped.id, { transaction: t });
      }

      return { supplierMapping, integrationMapping };
    });

    // Linha de nota ganha o InvoiceItem (e lote/PDV) antes de sair; de catálogo só é apagada. O vínculo já foi
    // commitado, então falha aqui só vai pro log (as linhas que sobrarem continuam pendentes pra mapear).
    if (linksProduct) {
      try {
        await unmappedInvoiceProductService.resolveFromCreatedProduct({
          externalId: unmapped.external_id!,
          integrationsId,
          productId: params.productId,
        });
      } catch (error: any) {
        console.error(
          `[SUPPLIER_MAPPING] vínculo do não mapeado ${unmapped.id} criado, mas falhou ao resolver as linhas do código ${unmapped.external_id}: ${error.message}`,
        );
      }
    }

    return {
      supplierMapping,
      integrationMapping,
      integration: { id: integration.id, name: integration.name },
      integrationMappings: await integrationMappingService.findProductMappingsInIntegration(
        params.productId,
        integrationsId,
      ),
    };
  }
}

export default new SupplierMappingService();
