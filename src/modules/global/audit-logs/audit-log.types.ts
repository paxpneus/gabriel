// Entidade auditada — enum TS (sem ENUM de banco) pra auditar entidade nova sem migration.
export enum AuditEntity {
  PRODUCT = "PRODUCT",
  PRODUCT_CONFIG = "PRODUCT_CONFIG",
  SUPPLIER_MAPPING = "SUPPLIER_MAPPING",
  INTEGRATION_MAPPING = "INTEGRATION_MAPPING",
  EXPEDITION_BATCH = "EXPEDITION_BATCH",
}

// Quem gerou o log: usuário logado, sistema (sync/fila) ou link do PDV (sem login, ainda sem fluxo auditado).
export enum AuditOrigin {
  USER = "USER",
  SYSTEM = "SYSTEM",
  PDV = "PDV",
}

export enum AuditAction {
  CREATE = "CREATE",
  UPDATE = "UPDATE",
  DELETE = "DELETE",
}

// Outra entidade tocada pela mesma operação — listada dentro do log principal
// pra quem audita uma entidade ver o impacto inteiro da operação.
export interface AuditAffectedEntity {
  entity: AuditEntity;
  internal_id: string;
  action: AuditAction;
  label?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}

// Formato do `changes` JSONB: estado antes/depois da própria entidade, entidades
// afetadas e referência à entidade que originou a operação (quando este log é um reflexo dela).
export interface AuditChanges {
  summary?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  affected?: AuditAffectedEntity[];
  origin?: { entity: AuditEntity; internal_id: string; label?: string };
}

export interface AuditLogAttributes {
  id: string;
  user_id: string | null;
  date: Date;
  entity: AuditEntity;
  internal_id: string;
  action: AuditAction;
  description: string;
  changes: AuditChanges | null;
  origin: AuditOrigin;
}

export interface AuditLogCreationAttributes
  extends Omit<AuditLogAttributes, "id" | "date" | "origin"> {
  date?: Date;
  origin?: AuditOrigin;
}

// Entrada aceita por `auditLogService.record` — description é gerada pelo helper.
export interface AuditLogEntry {
  userId?: string | null;
  entity: AuditEntity;
  internalId: string;
  action: AuditAction;
  changes: AuditChanges;
  // Sem valor = USER (fluxo manual).
  origin?: AuditOrigin;
}

// Quem/quando da última alteração de uma entidade (ex.: quem definiu o EAN pelo físico).
export interface AuditLogAuthor {
  user_id: string | null;
  user_name: string | null;
  date: Date;
}
