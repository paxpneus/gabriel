import {
  AuditAction,
  AuditAffectedEntity,
  AuditChanges,
  AuditEntity,
} from "../audit-log.types";

// Nomes legíveis (pt-BR, texto pra auditor) de cada entidade/ação auditada.
const ENTITY_LABELS: Record<AuditEntity, string> = {
  [AuditEntity.PRODUCT]: "Produto",
  [AuditEntity.PRODUCT_CONFIG]: "ProductConfig",
  [AuditEntity.SUPPLIER_MAPPING]: "SupplierMapping",
  [AuditEntity.INTEGRATION_MAPPING]: "IntegrationMapping",
};

const ACTION_LABELS: Record<AuditAction, string> = {
  [AuditAction.CREATE]: "criado",
  [AuditAction.UPDATE]: "alterado",
  [AuditAction.DELETE]: "removido",
};

// Valor curto e estável pro texto: null/undefined viram "—", objeto vira JSON.
const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return `"${String(value)}"`;
};

// Lista "campo: antes → depois" só dos campos que mudaram; em CREATE/DELETE lista o estado inteiro.
const describeFieldChanges = (
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null,
): string => {
  const keys = Array.from(
    new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  );

  return keys
    .filter(
      (key) =>
        JSON.stringify(before?.[key] ?? null) !==
        JSON.stringify(after?.[key] ?? null),
    )
    .map((key) => `${key}: ${formatValue(before?.[key])} → ${formatValue(after?.[key])}`)
    .join(", ");
};

const describeAffected = (affected: AuditAffectedEntity): string => {
  const label = affected.label ? ` ${affected.label}` : "";
  const fields = describeFieldChanges(affected.before, affected.after);
  return `${ENTITY_LABELS[affected.entity]} ${affected.internal_id}${label} ${ACTION_LABELS[affected.action]}${fields ? ` (${fields})` : ""}`;
};

// Monta o texto padronizado de auditoria a partir da entidade, ação e changes —
// mesma estrutura sempre: cabeçalho, resumo, campos alterados, origem e entidades afetadas.
export const buildAuditDescription = (
  entity: AuditEntity,
  action: AuditAction,
  changes: AuditChanges,
): string => {
  const parts = [`${ENTITY_LABELS[entity]} ${ACTION_LABELS[action]}`];

  if (changes.summary) parts.push(changes.summary);

  const fields = describeFieldChanges(changes.before, changes.after);
  if (fields) parts.push(`Campos: ${fields}`);

  if (changes.origin) {
    const label = changes.origin.label ? ` ${changes.origin.label}` : "";
    parts.push(`Origem: ${ENTITY_LABELS[changes.origin.entity]} ${changes.origin.internal_id}${label}`);
  }

  if (changes.affected?.length) {
    parts.push(`Afetados: ${changes.affected.map(describeAffected).join("; ")}`);
  }

  return parts.join(" — ");
};
