import blingManualImportHandler from "./providers/bling.handler";
import tecincoManualImportHandler from "./providers/tecinco.handler";
import { ManualImportHandler } from "./manual-import.types";

// Cada integração nova só precisa de uma entrada aqui.
const MANUAL_IMPORT_HANDLERS: ManualImportHandler[] = [
  blingManualImportHandler,
  tecincoManualImportHandler,
];

// Handler + id da integração dele já resolvido no banco.
export interface ResolvedManualImportHandler {
  handler: ManualImportHandler;
  integrationId: string;
}

// Integração não configurada no banco fica de fora, sem derrubar as outras.
export async function listManualImportHandlers(): Promise<
  ResolvedManualImportHandler[]
> {
  const integrations = await Promise.allSettled(
    MANUAL_IMPORT_HANDLERS.map((handler) => handler.getIntegration()),
  );
  return integrations.flatMap((integration, index) =>
    integration.status === "fulfilled"
      ? [{ handler: MANUAL_IMPORT_HANDLERS[index], integrationId: integration.value.id }]
      : [],
  );
}

// Compara pelo id da integração — nenhum nome de integração fica escrito no código.
export async function resolveManualImportHandler(
  integrationId: string,
): Promise<ManualImportHandler | null> {
  const handlers = await listManualImportHandlers();
  return (
    handlers.find((resolved) => resolved.integrationId === integrationId)
      ?.handler ?? null
  );
}
