import { z } from "zod";
import {
  RequiredUserFields,
  phoneField,
} from "../../../company/users/users/schemas/user.schema";
import { CONTACT_TYPES } from "../contacts.types";

// POST /contacts/with-user: cria User + Contact; unit_business_id é ignorado em tipo com loja fixa (afiliado → 21). Sem custom_data: só por rota própria.
export const CreateContactWithUserSchema = z.object({
  ...RequiredUserFields,
  phone: phoneField,
  type: z.enum(CONTACT_TYPES, { error: "Tipo de contato inválido" }),
  unit_business_id: z.string().uuid("ID da unidade deve ser um UUID válido").optional(),
});

export type CreateContactWithUserInput = z.infer<typeof CreateContactWithUserSchema>;
