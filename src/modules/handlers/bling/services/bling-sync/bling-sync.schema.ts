import { z } from "zod";
import {
  INVOICE_STEPS,
  POPULATE_BY_ID_ENTITIES,
  POPULATE_ENTITIES,
} from "./bling-sync.types";

export const MAX_IDS_PER_REQUEST = 50;

export const PopulateSchema = z.object({
  entities: z
    .array(z.enum(POPULATE_ENTITIES), {
      error: `Informe ao menos uma entidade: ${POPULATE_ENTITIES.join(", ")}`,
    })
    .min(1, "Informe ao menos uma entidade")
    .transform((entities) => [...new Set(entities)]),

  invoiceTypes: z
    .array(z.enum(INVOICE_STEPS), {
      error: `Tipos de nota válidos: ${INVOICE_STEPS.join(", ")}`,
    })
    .min(1, "Informe ao menos um tipo de nota")
    .transform((types) => [...new Set(types)])
    .optional(),

  orderStatus: z
    .array(z.string().trim().min(1).toUpperCase(), {
      error: "orderStatus deve ser uma lista de status (ex.: EM_ABERTO)",
    })
    .min(1, "Informe ao menos um status de pedido")
    .transform((statuses) => [...new Set(statuses)])
    .optional(),

  limit: z.coerce
    .number()
    .int("O limite deve ser um número inteiro")
    .positive("O limite deve ser maior que zero")
    .optional(),
});

export const PopulateByIdSchema = z.object({
  entity: z.enum(POPULATE_BY_ID_ENTITIES, {
    error: `Entidade inválida. Opções: ${POPULATE_BY_ID_ENTITIES.join(", ")}`,
  }),

  ids: z
    .array(z.coerce.number().int().positive("ID da Bling inválido"), {
      error: "Informe a lista de IDs da Bling",
    })
    .min(1, "Informe ao menos um ID")
    .max(MAX_IDS_PER_REQUEST, `Máximo de ${MAX_IDS_PER_REQUEST} IDs por chamada`)
    .transform((ids) => [...new Set(ids)]),
});
