import { buildAuditEntries } from "../../../global/audit-logs/helpers/audit-change";
import { AuditAction, AuditEntity, AuditLogEntry, AuditOrigin } from "../../../global/audit-logs/audit-log.types";

// Produto excluído no ERP (Bling situacao=E, Tecinco deleted/404): uma entrada PRODUCT de origem sistema, com o que foi
// desvinculado da integração em affected. `productAfter` só vem quando inativou (sem mapping em nenhuma integração).
export const productRetiredFromIntegrationAudit = (params: {
  integrationName: string;
  code: string;
  productBefore: { id: string; is_active: boolean };
  productAfter: { is_active: boolean } | null;
  mappings: Array<{ id: string; external_id: string; is_primary: boolean }>;
  supplierMappings: Array<{ id: string; supplier_product_code: string; is_physical_override?: boolean | null }>;
  configs: Array<{ id: string; sku?: string | null; gtin?: string | null }>;
}): AuditLogEntry[] => {
  const { integrationName, productBefore, productAfter } = params;
  // Sem inativação o produto não muda: before/after null, só as remoções em affected.
  let mainBefore: object | null = null;
  if (productAfter) mainBefore = productBefore;
  const outcome = productAfter
    ? " e inativado, sem vínculo com nenhuma integração"
    : ", segue ativo pelo vínculo com outra integração";
  // EAN físico confirmado por alguém some junto: avisa no resumo, não só como DE x PARA removido.
  const physicalEans = params.supplierMappings.filter((m) => m.is_physical_override).map((m) => m.supplier_product_code);
  let physicalNote = "";
  if (physicalEans.length) physicalNote = `. Confirmação de EAN físico removida: ${physicalEans.join(", ")}`;

  return buildAuditEntries({
    userId: null,
    origin: AuditOrigin.SYSTEM,
    summary: `Produto excluído no ${integrationName} (código ${params.code} no ERP): desvinculado do ${integrationName}${outcome}${physicalNote}`,
    main: {
      entity: AuditEntity.PRODUCT,
      action: AuditAction.UPDATE,
      fields: ["is_active"],
      change: { id: productBefore.id, before: mainBefore, after: productAfter },
    },
    touched: [
      {
        entity: AuditEntity.INTEGRATION_MAPPING,
        action: AuditAction.DELETE,
        fields: ["external_id", "is_primary"],
        changes: params.mappings.map((m) => ({
          id: m.id,
          before: m,
          after: null,
          label: `(código ${m.external_id} no ERP)`,
        })),
      },
      {
        entity: AuditEntity.SUPPLIER_MAPPING,
        action: AuditAction.DELETE,
        fields: ["supplier_product_code", "is_physical_override"],
        changes: params.supplierMappings.map((m) => ({ id: m.id, before: m, after: null })),
      },
      {
        entity: AuditEntity.PRODUCT_CONFIG,
        action: AuditAction.DELETE,
        fields: ["sku", "gtin"],
        changes: params.configs.map((c) => ({ id: c.id, before: c, after: null })),
      },
    ],
  });
};
