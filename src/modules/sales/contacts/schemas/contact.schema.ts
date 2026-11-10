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

// Status do usuário na tela (users.active): "Inativo" bloqueia o login sem apagar o cadastro.
export const CONTACT_USER_STATUSES = ["Ativo", "Inativo"] as const;

// PUT /contacts/:id/with-user: tudo opcional; nome vale pro contato e pro usuário; senha só muda se vier.
export const UpdateContactWithUserSchema = z
  .object({
    name: RequiredUserFields.name.optional(),
    email: RequiredUserFields.email.optional(),
    password: RequiredUserFields.password.optional(),
    phone: phoneField,
    status: z.enum(CONTACT_USER_STATUSES, { error: "Status deve ser Ativo ou Inativo" }).optional(),
  })
  .strict();

export type UpdateContactWithUserInput = z.infer<typeof UpdateContactWithUserSchema>;
