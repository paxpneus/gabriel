import { z } from "zod";
import {
  RequiredUserFields,
  phoneField,
} from "../../../company/users/users/schemas/user.schema";
import { CONTACT_TYPES } from "../contacts.types";

// POST /contacts/with-user: creates User + Contact; unit_business_id is ignored for types with a fixed store (affiliated → 21).
export const CreateContactWithUserSchema = z.object({
  ...RequiredUserFields,
  phone: phoneField,
  type: z.enum(CONTACT_TYPES, { error: "Tipo de contato inválido" }),
  unit_business_id: z.string().uuid("ID da unidade deve ser um UUID válido").optional(),
  custom_data: z.record(z.string(), z.unknown()).optional(),
});

export type CreateContactWithUserInput = z.infer<typeof CreateContactWithUserSchema>;
