/**
 * Index central de todos os schemas de validação
 * Exporte aqui todos os schemas Zod para fácil acesso
 */

// User
export {
  CreateUserSchema,
  UpdateUserSchema,
  UserIdSchema,
  LoginSchema,
  ChangePasswordSchema,
  type CreateUserInput,
  type UpdateUserInput,
  type UserIdInput,
  type LoginInput,
  type ChangePasswordInput,
} from './user.schema';

// Invoice (Exemplo)
export {
  CreateInvoiceSchema,
  UpdateInvoiceSchema,
  InvoiceIdSchema,
  InvoiceQuerySchema,
  InvoiceStatusEnum,
  InvoiceTypeEnum,
  type CreateInvoiceInput,
  type UpdateInvoiceInput,
  type InvoiceIdInput,
  type InvoiceQueryInput,
  type InvoiceStatus,
  type InvoiceType,
} from './invoice.schema';

// Stock Movement
export {
  CreateStockMovementSchema,
  UpdateStockMovementSchema,
  type CreateStockMovementInput,
  type UpdateStockMovementInput,
} from './stock-movement.schema';

// Adicione aqui os schemas de outras tabelas conforme necessário
// export { CreateProductSchema, ... } from './product.schema';
// export { CreateTransporterSchema, ... } from './transporter.schema';
