import { z } from "zod";
import {
  MANUAL_IMPORT_ENTITIES,
  MANUAL_IMPORT_SEARCH_BY,
} from "./manual-import.types";

// Campos comuns à busca e ao confirm.
const integrationId = z.uuid({ error: "integrationId inválido" });

const entity = z.enum(MANUAL_IMPORT_ENTITIES, {
  error: `Entidade inválida. Opções: ${MANUAL_IMPORT_ENTITIES.join(", ")}`,
});

// local_id precisa ser UUID (senão a consulta no Postgres quebra); a chave de acesso é validada no handler.
export const ManualImportSearchSchema = z
  .object({
    integrationId,
    entity,
    by: z.enum(MANUAL_IMPORT_SEARCH_BY, {
      error: `Tipo de busca inválido. Opções: ${MANUAL_IMPORT_SEARCH_BY.join(", ")}`,
    }),
    value: z.coerce.string().trim().min(1, "Informe o valor da busca"),
  })
  .refine(
    (data) => data.by !== "local_id" || z.uuid().safeParse(data.value).success,
    { path: ["value"], message: "local_id deve ser o id (UUID) do registro no sistema" },
  );

// Limite de itens validado no service, pra responder { code: "MAX_ITEMS_EXCEEDED", max }.
export const ManualImportConfirmSchema = z.object({
  integrationId,
  entity,
  externalIds: z
    .array(z.coerce.string().trim().min(1), {
      error: "Informe a lista de externalIds",
    })
    .min(1, "Informe ao menos um item")
    .transform((ids) => [...new Set(ids)]),
});
