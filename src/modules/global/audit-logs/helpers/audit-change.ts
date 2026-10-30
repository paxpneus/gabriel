import { AuditAction, AuditEntity, AuditLogEntry, AuditOrigin } from "../audit-log.types";

// Uma linha mexida: before = lida (travada) antes de alterar, after = como ficou no banco — nunca o que se pretendia gravar.
export interface AuditRowChange {
  id: string;
  before: object | null;
  after: object | null;
  label?: string;
}

// Linhas de uma model mexidas na operação; `fields` = colunas que entram no log.
export interface AuditTouched {
  entity: AuditEntity;
  action: AuditAction;
  fields: string[];
  changes: AuditRowChange[];
}

export interface AuditChangeInput {
  userId?: string | null;
  origin?: AuditOrigin;
  summary: string;
  main: { entity: AuditEntity; action: AuditAction; fields: string[]; change: AuditRowChange };
  touched?: AuditTouched[];
  // true = também uma entrada por linha mexida (com changes.origin apontando pra principal), pro histórico dela.
  mirror?: boolean;
}

// Só os `fields` da linha (instância Sequelize ou objeto) — copia na hora, então alterar a instância depois não muda o log.
const pickFields = (row: object | null, fields: string[]): Record<string, unknown> | null => {
  if (!row) return null;
  return Object.fromEntries(fields.map((field) => [field, (row as Record<string, unknown>)[field]]));
};

// Genérico: models mexidas (before/after) + mensagem → entradas prontas pro auditLogService.record (entrada principal
// com as mexidas em affected; com `mirror`, mais uma por mexida). Cada módulo monta o seu em helpers/audit.ts.
export const buildAuditEntries = (input: AuditChangeInput): AuditLogEntry[] => {
  const { main } = input;
  const affected = (input.touched ?? []).flatMap((touched) =>
    touched.changes.map((change) => ({
      entity: touched.entity,
      internal_id: change.id,
      action: touched.action,
      label: change.label,
      before: pickFields(change.before, touched.fields),
      after: pickFields(change.after, touched.fields),
    })),
  );

  const entries: AuditLogEntry[] = [
    {
      userId: input.userId ?? null,
      origin: input.origin,
      entity: main.entity,
      internalId: main.change.id,
      action: main.action,
      changes: {
        summary: input.summary,
        before: pickFields(main.change.before, main.fields),
        after: pickFields(main.change.after, main.fields),
        affected,
      },
    },
  ];

  if (input.mirror) {
    for (const item of affected) {
      entries.push({
        userId: input.userId ?? null,
        origin: input.origin,
        entity: item.entity,
        internalId: item.internal_id,
        action: item.action,
        changes: {
          summary: input.summary,
          before: item.before,
          after: item.after,
          origin: { entity: main.entity, internal_id: main.change.id, label: main.change.label },
        },
      });
    }
  }

  return entries;
};
