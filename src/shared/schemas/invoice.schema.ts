import { z } from 'zod';

/**
 * Schemas de validação para o modelo Invoice
 * Exemplo de como criar schemas para outras tabelas
 */

const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cnpjCpfRegex = /^\d{11,14}$/; // 11 para CPF, 14 para CNPJ

/**
 * Status permitidos para invoice
 */
export const InvoiceStatusEnum = z.enum(['OPEN', 'PENDING', 'FINISHED']);
export type InvoiceStatus = z.infer<typeof InvoiceStatusEnum>;

/**
 * Tipos de invoice
 */
export const InvoiceTypeEnum = z.enum(['INCOMING', 'OUTGOING']);
export type InvoiceType = z.infer<typeof InvoiceTypeEnum>;

/**
 * Schema para criar uma nova nota fiscal
 */
export const CreateInvoiceSchema = z.object({
  nf_number: z
    .string({ error: 'Número da NF é obrigatório' })
    .min(1, 'Número da NF é obrigatório')
    .max(20, 'Número da NF não pode ter mais de 20 caracteres'),

  customer_document: z
    .string({ error: 'Documento do cliente é obrigatório' })
    .regex(cnpjCpfRegex, 'Documento deve conter 11 (CPF) ou 14 (CNPJ) dígitos'),

  total_amount: z
    .number({ error: 'Valor total é obrigatório' })
    .positive('Valor total deve ser maior que 0'),

  type: InvoiceTypeEnum.default('INCOMING'),

  status: InvoiceStatusEnum.default('OPEN'),

  unit_business_id: z
    .string({ error: 'ID da unidade de negócio é obrigatório' })
    .regex(uuidRegex, 'ID da unidade deve ser um UUID válido'),

  transporter_id: z
    .string()
    .regex(uuidRegex, 'ID do transporter deve ser um UUID válido')
    .optional()
    .nullable(),

  reference: z
    .string()
    .max(255, 'Referência não pode ter mais de 255 caracteres')
    .optional(),

  observations: z
    .string()
    .max(1000, 'Observações não podem ter mais de 1000 caracteres')
    .optional(),
});

export type CreateInvoiceInput = z.infer<typeof CreateInvoiceSchema>;

/**
 * Schema para atualizar uma nota fiscal
 */
export const UpdateInvoiceSchema = z.object({
  nf_number: z
    .string()
    .min(1, 'Número da NF é obrigatório')
    .max(20, 'Número da NF não pode ter mais de 20 caracteres')
    .optional(),

  customer_document: z
    .string()
    .regex(cnpjCpfRegex, 'Documento deve conter 11 (CPF) ou 14 (CNPJ) dígitos')
    .optional(),

  total_amount: z
    .number()
    .positive('Valor total deve ser maior que 0')
    .optional(),

  type: InvoiceTypeEnum.optional(),

  status: InvoiceStatusEnum.optional(),

  transporter_id: z
    .string()
    .regex(uuidRegex, 'ID do transporter deve ser um UUID válido')
    .optional()
    .nullable(),

  reference: z
    .string()
    .max(255, 'Referência não pode ter mais de 255 caracteres')
    .optional(),

  observations: z
    .string()
    .max(1000, 'Observações não podem ter mais de 1000 caracteres')
    .optional(),
}).strict();

export type UpdateInvoiceInput = z.infer<typeof UpdateInvoiceSchema>;

/**
 * Schema para validar ID da invoice (params)
 */
export const InvoiceIdSchema = z.object({
  id: z
    .string({ error: 'ID é obrigatório' })
    .regex(uuidRegex, 'ID deve ser um UUID válido'),
});

export type InvoiceIdInput = z.infer<typeof InvoiceIdSchema>;

/**
 * Schema para busca com filtros (query parameters)
 */
export const InvoiceQuerySchema = z.object({
  status: InvoiceStatusEnum.optional(),
  type: InvoiceTypeEnum.optional(),
  unit_business_id: z
    .string()
    .regex(uuidRegex, 'ID da unidade deve ser um UUID válido')
    .optional(),
  nf_number: z.string().optional(),
  limit: z.coerce.number().positive().default(10),
  offset: z.coerce.number().nonnegative().default(0),
});

export type InvoiceQueryInput = z.infer<typeof InvoiceQuerySchema>;
