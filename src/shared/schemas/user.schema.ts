import { z } from "zod";
import { isValidCPF } from "../utils/validators/document";

/**
 * Validações customizadas
 */
const cpfRegex = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$|^\d{11}$/;

const UserConfigUpdateFields = {
  theme: z.enum(["dark", "light"]).optional(),
  profile_photo: z.string().nullable().optional(),
  language: z
    .string()
    .min(2, "Idioma deve ter pelo menos 2 caracteres")
    .max(10, "Idioma não pode ter mais de 10 caracteres")
    .optional(),
  timezone: z
    .string()
    .min(1, "Timezone é obrigatório")
    .max(100, "Timezone não pode ter mais de 100 caracteres")
    .optional(),
  items_per_page: z
    .number()
    .int("Itens por página deve ser um número inteiro")
    .min(1, "Itens por página deve ser maior que zero")
    .optional(),
  notifications_enabled: z.boolean().optional(),
  visualize_only_current_unit_business: z.boolean().optional(),
  compact_mode: z.boolean().optional(),
  auto_advance_collector: z.boolean().optional(),
};

const UserConfigUpdateSchema = z.object(UserConfigUpdateFields).strict();

/**
 * Schema para criar um novo usuário
 * Todos os campos são obrigatórios (exceto os explicitamente marcados como opcionais)
 */
export const CreateUserSchema = z.object({
  name: z
    .string({ error: "Nome é obrigatório" })
    .min(3, "Nome deve ter pelo menos 3 caracteres")
    .max(255, "Nome não pode ter mais de 255 caracteres")
    .trim(),

  cpf: z
    .string({ error: "CPF é obrigatório" })
    .regex(cpfRegex, "CPF deve conter exatamente 11 dígitos")
    .trim()
    .refine((v) => isValidCPF(v), "CPF inválido"),

  email: z
    .string({ error: "Email é obrigatório" })
    .email("Email inválido")
    .max(255, "Email não pode ter mais de 255 caracteres")
    .toLowerCase()
    .trim(),

  password: z
    .string({ error: "Senha é obrigatória" })
    .min(8, "Senha deve ter no mínimo 8 caracteres")
    .max(255, "Senha não pode ter mais de 255 caracteres"),

  type: z.string().optional(), // <-- Adicionado aqui como string opcional
  id_system: z
    .number()
    .int("ID do sistema deve ser um número inteiro")
    .positive("ID do sistema deve ser positivo")
    .nullable()
    .optional(),

  user_unit_business: z
    .array(z.string().uuid("IDs da unidade devem ser UUIDs válidos"))
    .nullable()
    .optional()
    .transform((val) => val ?? []),

  main_unit_business_id: z.string().nullable().optional(),

  unit_business_id: z
    .string({ error: "ID da unidade de negócio é obrigatório" })
    .uuid("ID da unidade deve ser um UUID válido"),

  role_id: z
    .string({ error: "ID do papel é obrigatório" })
    .uuid("ID do papel deve ser um UUID válido"),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

/**
 * Schema para atualizar um usuário
 * Todos os campos são opcionais
 */
export const UpdateUserSchema = z
  .object({
    name: z
      .string()
      .min(3, "Nome deve ter pelo menos 3 caracteres")
      .max(255, "Nome não pode ter mais de 255 caracteres")
      .trim()
      .optional(),

    cpf: z
      .string()
      .regex(cpfRegex, "CPF deve conter exatamente 11 dígitos")
      .trim()
      .refine((v) => isValidCPF(v!), "CPF inválido")
      .optional(),

    email: z
      .string()
      .email("Email inválido")
      .max(255, "Email não pode ter mais de 255 caracteres")
      .toLowerCase()
      .trim()
      .optional(),

    password: z
      .string()
      .min(8, "Senha deve ter no mínimo 8 caracteres")
      .max(255, "Senha não pode ter mais de 255 caracteres")
      .optional(),

    type: z.string().optional(), // <-- Adicionado aqui também para o fluxo de update
    id_system: z
      .number()
      .int("ID do sistema deve ser um número inteiro")
      .positive("ID do sistema deve ser positivo")
      .nullable()
      .optional(),

    unit_business_id: z
      .string()
      .uuid("ID da unidade deve ser um UUID válido")
      .optional(),

    main_unit_business_id: z.string().nullable().optional(),

    user_unit_business: z
      .array(z.string().uuid("IDs da unidade devem ser UUIDs válidos"))
      .nullable()
      .optional()
      .transform((val) => val ?? []),

    role_id: z.string().uuid("ID do papel deve ser um UUID válido").optional(),

    config: UserConfigUpdateSchema.optional(),
    ...UserConfigUpdateFields,
  })
  .strict();

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

/**
 * Schema para validar ID do usuário (params)
 */
export const UserIdSchema = z.object({
  id: z
    .string({ error: "ID é obrigatório" })
    .uuid("ID deve ser um UUID válido"),
});

export type UserIdInput = z.infer<typeof UserIdSchema>;

/**
 * Schema para login (email + senha)
 */
export const LoginSchema = z.object({
  email: z
    .string({ error: "Email é obrigatório" })
    .email("Email inválido")
    .toLowerCase()
    .trim(),

  password: z
    .string({ error: "Senha é obrigatória" })
    .min(1, "Senha é obrigatória"),
});

export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * Schema para mudança de senha
 */
export const ChangePasswordSchema = z
  .object({
    currentPassword: z
      .string({ error: "Senha atual é obrigatória" })
      .min(1, "Senha atual é obrigatória"),

    newPassword: z
      .string({ error: "Nova senha é obrigatória" })
      .min(8, "Nova senha deve ter no mínimo 8 caracteres")
      .max(255, "Nova senha não pode ter mais de 255 caracteres"),

    confirmPassword: z
      .string({ error: "Confirmação de senha é obrigatória" })
      .min(8, "Confirmação deve ter no mínimo 8 caracteres"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "As senhas não correspondem",
    path: ["confirmPassword"],
  });

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
