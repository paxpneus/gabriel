import { z } from 'zod';
import { isValidCPF } from '../utils/validators/document';

/**
 * Validações customizadas
 */
const cpfRegex = /^\d{3}\.?\d{3}\.?\d{3}-?\d{2}$|^\d{11}$/;
/**
 * Schema para criar um novo usuário
 * Todos os campos são obrigatórios
 */
export const CreateUserSchema = z.object({
  name: z
    .string({ error: 'Nome é obrigatório' })
    .min(3, 'Nome deve ter pelo menos 3 caracteres')
    .max(255, 'Nome não pode ter mais de 255 caracteres')
    .trim(),

  cpf: z
    .string({ error: 'CPF é obrigatório' })
    .regex(cpfRegex, 'CPF deve conter exatamente 11 dígitos')
    .trim()
    .refine(v => isValidCPF(v), 'CPF inválido'),
    

  email: z
    .string({ error: 'Email é obrigatório' })
    .email('Email inválido')
    .max(255, 'Email não pode ter mais de 255 caracteres')
    .toLowerCase()
    .trim(),

  password: z
    .string({ error: 'Senha é obrigatória' })
    .min(8, 'Senha deve ter no mínimo 8 caracteres')
    .max(255, 'Senha não pode ter mais de 255 caracteres'),

  unit_business_id: z
    .string({ error: 'ID da unidade de negócio é obrigatório' })
    .uuid('ID da unidade deve ser um UUID válido'),

  role_id: z
    .string({ error: 'ID do papel é obrigatório' })
    .uuid( 'ID do papel deve ser um UUID válido'),
});

export type CreateUserInput = z.infer<typeof CreateUserSchema>;

/**
 * Schema para atualizar um usuário
 * Todos os campos são opcionais
 */
export const UpdateUserSchema = z.object({
  name: z
    .string()
    .min(3, 'Nome deve ter pelo menos 3 caracteres')
    .max(255, 'Nome não pode ter mais de 255 caracteres')
    .trim()
    .optional(),

  cpf: z
    .string()
    .regex(cpfRegex, 'CPF deve conter exatamente 11 dígitos')
    .trim()
    .optional(),

  email: z
    .string()
    .email('Email inválido')
    .max(255, 'Email não pode ter mais de 255 caracteres')
    .toLowerCase()
    .trim()
    .optional(),

  password: z
    .string()
    .min(8, 'Senha deve ter no mínimo 8 caracteres')
    .max(255, 'Senha não pode ter mais de 255 caracteres')
    .optional(),

  unit_business_id: z
    .string()
    .uuid('ID da unidade deve ser um UUID válido')
    .optional(),

  role_id: z
    .string()
    .uuid('ID do papel deve ser um UUID válido')
    .optional(),
}).strict();

export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

/**
 * Schema para validar ID do usuário (params)
 */
export const UserIdSchema = z.object({
  id: z
    .string({ error: 'ID é obrigatório' })
    .uuid('ID deve ser um UUID válido'),
});

export type UserIdInput = z.infer<typeof UserIdSchema>;

/**
 * Schema para login (email + senha)
 */
export const LoginSchema = z.object({
  email: z
    .string({ error: 'Email é obrigatório' })
    .email('Email inválido')
    .toLowerCase()
    .trim(),

  password: z
    .string({ error: 'Senha é obrigatória' })
    .min(1, 'Senha é obrigatória'),
});

export type LoginInput = z.infer<typeof LoginSchema>;

/**
 * Schema para mudança de senha
 */
export const ChangePasswordSchema = z.object({
  currentPassword: z
    .string({ error: 'Senha atual é obrigatória' })
    .min(1, 'Senha atual é obrigatória'),

  newPassword: z
    .string({ error: 'Nova senha é obrigatória' })
    .min(8, 'Nova senha deve ter no mínimo 8 caracteres')
    .max(255, 'Nova senha não pode ter mais de 255 caracteres'),

  confirmPassword: z
    .string({ error: 'Confirmação de senha é obrigatória' })
    .min(8, 'Confirmação deve ter no mínimo 8 caracteres'),
}).refine((data) => data.newPassword === data.confirmPassword, {
  message: 'As senhas não correspondem',
  path: ['confirmPassword'],
});

export type ChangePasswordInput = z.infer<typeof ChangePasswordSchema>;
