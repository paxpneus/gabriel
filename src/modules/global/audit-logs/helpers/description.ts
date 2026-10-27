import {
  AuditAction,
  AuditAffectedEntity,
  AuditChanges,
  AuditEntity,
} from "../audit-log.types";

// Texto pra usuário leigo (não conhece código nem tabela): nomes de entidade/ação/campo em português comum.
const ENTITY_LABELS: Record<AuditEntity, string> = {
  [AuditEntity.PRODUCT]: "Produto",
  [AuditEntity.PRODUCT_CONFIG]: "Configurações do produto",
  [AuditEntity.SUPPLIER_MAPPING]: "Mapeamento DE x PARA",
  [AuditEntity.INTEGRATION_MAPPING]: "Mapeamento de integração",
};

const ACTION_LABELS: Record<AuditAction, string> = {
  [AuditAction.CREATE]: "criado",
  [AuditAction.UPDATE]: "alterado",
  [AuditAction.DELETE]: "removido",
};

// Nome amigável de cada coluna que aparece no changes; coluna sem entrada aqui sai com o nome técnico.
const FIELD_LABELS: Record<string, string> = {
  gtin: "EAN",
  gtin_erp: "EAN no ERP",
  sku: "SKU",
  supplier_product_code: "Código",
  external_id: "Código no ERP",
  is_primary: "Principal",
  is_physical_override: "Definido pelo físico",
  product_id: "Produto",
  unit_business_id: "Loja",
  integrations_id: "Integração",
};

// Valor curto e estável pro texto: null/undefined viram "—", booleano vira sim/não, objeto vira JSON.
const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "sim" : "não";
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
    .map((key) => `${FIELD_LABELS[key] ?? key}: ${formatValue(before?.[key])} → ${formatValue(after?.[key])}`)
    .join(", ");
};

const describeAffected = (affected: AuditAffectedEntity): string => {
  const label = affected.label ? ` ${affected.label}` : "";
  const fields = describeFieldChanges(affected.before, affected.after);
  // Id técnico por último, entre colchetes: o leigo lê o rótulo, o suporte acha o registro.
  return `${ENTITY_LABELS[affected.entity]}${label} ${ACTION_LABELS[affected.action]}${fields ? ` (${fields})` : ""} [id ${affected.internal_id}]`;
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
  if (fields) parts.push(`Alterações: ${fields}`);

  if (changes.origin) {
    const label = changes.origin.label ? ` ${changes.origin.label}` : "";
    parts.push(`Origem: ${ENTITY_LABELS[changes.origin.entity]}${label} [id ${changes.origin.internal_id}]`);
  }

  if (changes.affected?.length) {
    parts.push(`Também afetados: ${changes.affected.map(describeAffected).join("; ")}`);
  }

  return parts.join(" — ");
};
