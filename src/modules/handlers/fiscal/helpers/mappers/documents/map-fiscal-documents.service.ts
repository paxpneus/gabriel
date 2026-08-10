// helpers/mappers/map-document-api.ts
import { DocumentSearchHandler } from "./map-fiscal-documents.types";
import { siegDocumentHandler } from "../../../sieg/services/documents/ctes/cte.service";

/**
 * Registry central: cada provider novo de busca de XML só precisa de uma entrada aqui.
 */
const documentHandlers: Record<string, DocumentSearchHandler> = {
  Sieg: siegDocumentHandler,
};

/**
 * "Descobre" o handler (api + funções) do provider de documentos pelo nome.
 */
export const resolveDocumentHandler = (provider_name: string): DocumentSearchHandler => {
  const handler = documentHandlers[provider_name];

  if (!handler) {
    throw new Error(`Provider de documentos "${provider_name}" não possui integração implementada.`);
  }

  return handler;
};