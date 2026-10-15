import type { ManualImportEntity, ManualImportWarning } from "./manual-import.types";

// BullMQ: menor número = maior prioridade; 1 é o topo (empata FIFO com os outros jobs manuais).
export const MANUAL_IMPORT_PRIORITY = 1;
// Máximo de itens por import (confirm) — o front também trava a seleção nisso.
export const MANUAL_IMPORT_MAX_ITEMS = 10;
// Nome de todo job manual; é por ele que o aviso de "outro import rodando" procura nas filas.
export const MANUAL_IMPORT_JOB_NAME = "manual-import";

// Validade do resultado da busca guardado pro confirm.
export const MANUAL_IMPORT_SEARCH_TTL_S = 30 * 60;
// Por quanto tempo o último import do usuário fica consultável no /status.
export const MANUAL_IMPORT_RUN_TTL_S = 7 * 24 * 3600;
// Lock e claims são soltos quando o import termina — o TTL só cobre crash.
export const MANUAL_IMPORT_LOCK_TTL_MS = 6 * 3600 * 1000;
// Sem retenção o job some ao completar e o andamento veria not_found.
export const MANUAL_IMPORT_COMPLETED_RETENTION_S = 24 * 3600;

// Chaves Redis do módulo: lock/registro por usuário, claim por item e cache da busca.
export const manualImportKeys = {
  userLock: (requesterId: string) => `manual-import:user:${requesterId}:lock`,
  userRun: (requesterId: string) => `manual-import:user:${requesterId}:run`,
  itemClaim: (
    integrationId: string,
    entity: ManualImportEntity,
    externalId: string,
  ) => `manual-import:item:${integrationId}:${entity}:${externalId}`,
  search: (
    requesterId: string,
    integrationId: string,
    entity: ManualImportEntity,
    externalId: string,
  ) =>
    `manual-import:search:${requesterId}:${integrationId}:${entity}:${externalId}`,
};

// runId no jobId: o mesmo item em outro import vira job novo (BullMQ ignora jobId repetido).
export function manualImportJobId(
  entity: ManualImportEntity,
  externalId: string,
  runId: string,
): string {
  return `manual-import-${entity}-${externalId}-${runId}`;
}

// Opções de add() de todo job manual: prioridade máxima, nome e retenção do completed.
export function manualImportJobOptions() {
  return {
    priority: MANUAL_IMPORT_PRIORITY,
    name: MANUAL_IMPORT_JOB_NAME,
    removeOnComplete: { age: MANUAL_IMPORT_COMPLETED_RETENTION_S },
  };
}

// Avisos que não bloqueiam o import, só informam o front.
export const MANUAL_IMPORT_WARNINGS = {
  ALREADY_EXISTS_UPDATING: {
    code: "ALREADY_EXISTS_UPDATING",
    message: "Registro já existente no sistema, atualizando",
  },
  OTHER_MANUAL_IMPORTS_RUNNING: {
    code: "OTHER_MANUAL_IMPORTS_RUNNING",
    message:
      "Há outra importação manual em andamento nesta integração — o processamento pode demorar mais",
  },
} as const satisfies Record<string, ManualImportWarning>;
