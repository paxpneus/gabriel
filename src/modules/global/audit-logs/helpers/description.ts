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
  [AuditEntity.EXPEDITION_BATCH]: "Lote de expedição",
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
  is_physical_override: "EAN físico confirmado",
  product_id: "Produto",
  unit_business_id: "Loja",
  integrations_id: "Integração",
  is_active: "Ativo",
  delivery_note_generated_at: "Romaneio gerado em",
  operator_name: "Operador",
};

// Valor curto e estável pro texto: null/undefined viram "—", booleano vira sim/não, data em horário de Brasília, objeto vira JSON.
const formatValue = (value: unknown): string => {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "sim" : "não";
  if (value instanceof Date) return value.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  if (typeof value === "object") return JSON.stringify(value);
  return `"${String(value)}"`;
};

// Ids técnicos (uuid) não entram no texto pra leigo — ficam em changes.
const ID_FIELDS = new Set(["id", "product_id", "unit_business_id", "integrations_id"]);

// Lista "campo: antes → depois" só dos campos que mudaram; em CREATE/DELETE lista o estado inteiro. Em UPDATE só
// compara campo presente nos dois lados (campo ausente no antes não é "— → valor", é só não registrado).
const describeFieldChanges = (
  action: AuditAction,
  before?: Record<string, unknown> | null,
  after?: Record<string, unknown> | null,
): string => {
  const keys = Array.from(
    new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  );

  return keys
    .filter((key) => !ID_FIELDS.has(key))
    .filter((key) => action !== AuditAction.UPDATE || (key in (before ?? {}) && key in (after ?? {})))
    .filter(
      (key) =>
        JSON.stringify(before?.[key] ?? null) !==
        JSON.stringify(after?.[key] ?? null),
    )
    .map((key) => `${FIELD_LABELS[key] ?? key}: ${formatValue(before?.[key])} → ${formatValue(after?.[key])}`)
    .join(", ");
};

// Contagem por ação nas entidades afetadas — substantivo feminino pra não precisar concordar com a entidade.
const AFFECTED_ACTION_LABELS: Record<AuditAction, [string, string]> = {
  [AuditAction.CREATE]: ["criação", "criações"],
  [AuditAction.UPDATE]: ["alteração", "alterações"],
  [AuditAction.DELETE]: ["remoção", "remoções"],
};

// Afetadas só como contagem por entidade/ação ("Mapeamento DE x PARA: 1 criação, 1 remoção") — o texto não
// cresce com o número de lojas/registros; o detalhe de cada uma fica em changes.affected.
const summarizeAffected = (affected: AuditAffectedEntity[]): string => {
  const counts = new Map<AuditEntity, Map<AuditAction, number>>();
  for (const item of affected) {
    const byAction = counts.get(item.entity) ?? new Map<AuditAction, number>();
    byAction.set(item.action, (byAction.get(item.action) ?? 0) + 1);
    counts.set(item.entity, byAction);
  }

  return [...counts.entries()]
    .map(([entity, byAction]) => {
      const actions = [...byAction.entries()].map(
        ([action, count]) => `${count} ${AFFECTED_ACTION_LABELS[action][count > 1 ? 1 : 0]}`,
      );
      return `${ENTITY_LABELS[entity]}: ${actions.join(", ")}`;
    })
    .join("; ");
};

// Monta o texto de auditoria como resumo: cabeçalho, resumo, campos da própria entidade, origem e contagem das afetadas.
export const buildAuditDescription = (
  entity: AuditEntity,
  action: AuditAction,
  changes: AuditChanges,
): string => {
  const parts = [`${ENTITY_LABELS[entity]} ${ACTION_LABELS[action]}`];

  if (changes.summary) parts.push(changes.summary);

  const fields = describeFieldChanges(action, changes.before, changes.after);
  if (fields) parts.push(`Alterações: ${fields}`);

  if (changes.origin) {
    const label = changes.origin.label ? ` ${changes.origin.label}` : "";
    parts.push(`Origem: ${ENTITY_LABELS[changes.origin.entity]}${label} [id ${changes.origin.internal_id}]`);
  }

  if (changes.affected?.length) {
    parts.push(`Também afetados: ${summarizeAffected(changes.affected)}`);
  }

  return parts.join(" — ");
};
