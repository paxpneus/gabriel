type Actions = 'read' | 'write' | 'delete' | 'update'

export type RoleType = 'CUSTOM' | 'REGULAR'

type Scopes =
  | 'Pedidos'
  | 'Notas Fiscais'
  | 'Produtos'
  | 'Estoque'
  | 'Inventário'
  | 'Lotes'
  | 'Usuários'
  | 'Fornecedores'
  | 'Perfis'
  | 'Unidades de Negócio'
  | 'Transportadoras'
  | 'Integrações'
  | 'Impressoras'
  | 'Multiplicador Estoque - Inventário'
  | 'Multiplicador Estoque - Entradas'
  | 'Financeiro - Produtos'
  | 'Todas as Lojas'

interface ChildEntity {
  entity: string
  label: string
}

interface Roles {
  scope: Scopes
  entity: string
  type: RoleType,
  permissions: Actions[]
  children?: ChildEntity[]
}

const all: Actions[] = ['read', 'write', 'delete', 'update']

export const ROLE_PERMISSIONS: Roles[] = [
  {
    scope: 'Pedidos',
    entity: 'orders',
    permissions: all,
    type: 'REGULAR',
    children: [
      { entity: 'order_items',   label: 'Itens do Pedido' },
      { entity: 'order_history', label: 'Histórico' },
      { entity: 'customers',     label: 'Clientes' },
      { entity: 'steps',         label: 'Etapas' },
    ],
  },
  {
    scope: 'Notas Fiscais',
    entity: 'invoices',
    permissions: all,
    type: 'REGULAR',
    children: [
      { entity: 'invoice_items',           label: 'Itens da NF' },
      { entity: 'entrance_scan_logs',      label: 'Logs de Entrada' },
      
    ],
  },
  {
    scope: 'Produtos',
    entity: 'products',
    permissions: all,
    type: 'REGULAR',
    children: [
      { entity: 'supplier_mappings',    label: 'Mapeamento de Fornecedores' },
      { entity: 'integration_mappings', label: 'Mapeamento de Integração' },
      { entity: 'unmapped_invoice_products', label: 'Produtos Não Mapeados' },
    ],
  },
  {
    scope: 'Estoque',
    entity: 'stocks',
    type: 'REGULAR',
    permissions: all,
  },
  {
    scope: 'Inventário',
    entity: 'inventory_batches',
    permissions: all,
    type: 'REGULAR',
    children: [
      { entity: 'inventory_batch_items', label: 'Itens do Inventário' },
      { entity: 'inventory_batch_logs',  label: 'Logs de Inventário' },
    ],
  },
  {
    scope: 'Lotes',
    entity: 'expedition_batches',
    permissions: all,
    type: 'REGULAR',
    children: [
      { entity: 'expedition_batch_items',    label: 'Itens do Lote' },
      { entity: 'expedition_batch_invoices', label: 'Notas do Lote' },
      { entity: 'expedition_scan_logs',      label: 'Logs de Lote' },
    ],
  },
  {
    scope: 'Usuários',
    entity: 'users',
    permissions: all,
    type: 'REGULAR',
    children: [
      { entity: 'roles', label: 'Perfis' },
    ],
  },
  {
    scope: 'Fornecedores',
    entity: 'suppliers',
    type: 'REGULAR',
    permissions: all,
    
  },
  {
    scope: 'Unidades de Negócio',
    entity: 'unit_businesses',
    type: 'REGULAR',
    permissions: all,
  },
  {
    scope: 'Transportadoras',
    entity: 'transporters',
    type: 'REGULAR',
    permissions: all,
  },
  {
    scope: 'Integrações',
    entity: 'integrations',
    permissions: all,
    type: 'REGULAR',
    children: [
      { entity: 'config_tokens', label: 'Tokens de Configuração' },
    ],
  },
  {
    scope: 'Impressoras',
    entity: 'printer_configs',
    type: 'REGULAR',
    permissions: all,
  },
   {
    scope: 'Multiplicador Estoque - Inventário',
    entity: 'multiply-stk-inventory',
    type: 'CUSTOM',
    permissions: ['read'],
  },
    {
    scope: 'Multiplicador Estoque - Entradas',
    entity: 'multiply-stk-entrance',
    type: 'CUSTOM',
    permissions: ['read'],
  },
  {
    scope: 'Financeiro - Produtos',
    entity: 'financial-pdt',
    type: 'CUSTOM',
    permissions: ['read'],
  },
  {
    scope: 'Todas as Lojas',
    entity: 'visualize-all-unit-business',
    type: 'CUSTOM',
    permissions: ['read'],
  },
]

// const selectPermissions = (scope: Scopes, permissions: Actions[]) => {
//     const selectedScope = ROLE_PERMISSIONS.find(s => s.scope == scope)
   
//     return {
//         scope: selectedScope?.scope,
//         entity: selectedScope?.entity,
//         permissions,
//     }
// }
