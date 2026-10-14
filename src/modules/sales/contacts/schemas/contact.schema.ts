import { z } from "zod";
import { CONTACT_TYPES } from "../contacts.types";
import { phoneField, RequiredUserFields } from "../../../company/users/users/schemas/user.schema";

/** Cria user + contact numa chamada; loja/role/user type vêm da config do tipo (contact-user-types.ts). */
export const CreateContactWithUserSchema = z.object({
  ...RequiredUserFields,
  phone: phoneField,
  type: z.enum(CONTACT_TYPES, { error: "Tipo de contato inválido" }),
  unit_business_id: z.string().uuid("ID da unidade deve ser um UUID válido").optional(),
  custom_data: z.record(z.string(), z.unknown()).optional(),
});

export type CreateContactWithUserInput = z.infer<typeof CreateContactWithUserSchema>;
