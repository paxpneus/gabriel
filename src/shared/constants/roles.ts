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
  | 'Estados'
  | 'Integrações'
  | 'Aplicativos'
  | 'Impressoras'
  | 'Multiplicador Estoque - Inventário'
  | 'Multiplicador Estoque - Entradas'
  | 'Dados Financeiros'
  | 'Todas as Lojas'
  | 'Operações'

interface ChildEntity {
  entity: string
  label: string
}

interface Roles {
  scope: Scopes
  entity: string
  type: RoleType
  route: string
  permissions: Actions[]
  children?: ChildEntity[]
}

const all: Actions[] = ['read', 'write', 'delete', 'update']

export const ROLE_PERMISSIONS: Roles[] = [
  {
    scope: 'Pedidos',
    entity: 'orders',
    route: 'order',
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
    route: 'invoice',
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
    route: 'products',
    permissions: all,
    type: 'REGULAR',
    children: [
      { entity: 'brands', label: 'Marcas' },
      { entity: 'supplier_mappings',    label: 'Mapeamento de Fornecedores' },
      { entity: 'integration_mappings', label: 'Mapeamento de Integração' },
      { entity: 'unmapped_invoice_products', label: 'Produtos Não Mapeados' },
    ],
  },
  {
    scope: 'Estoque',
    entity: 'stocks',
    route: 'stocks',
    type: 'REGULAR',
    permissions: all,
    children: [
      
      { entity: 'stock_movements', label: 'Movimentações de Estoque' },
    ]
  },
  {
    scope: 'Inventário',
    entity: 'inventory_batches',
    route: 'inventory_batch',
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
    route: 'batch',
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
    route: 'users',
    permissions: all,
    type: 'REGULAR',
    children: [
      { entity: 'roles', label: 'Perfis' },
    ],
  },
  {
    scope: 'Fornecedores',
    entity: 'suppliers',
    route: 'suppliers',
    type: 'REGULAR',
    permissions: all,
    
  },
  {
    scope: 'Unidades de Negócio',
    entity: 'unit_businesses',
    route: 'unit-business',
    type: 'REGULAR',
    permissions: all,
  },
  {
    scope: 'Transportadoras',
    entity: 'transporters',
    route: 'transporter',
    type: 'REGULAR',
    permissions: all,
  },
  {
    scope: 'Estados',
    entity: 'states',
    route: 'state',
    type: 'REGULAR',
    permissions: all,
  },
  {
    scope: 'Integrações',
    entity: 'integrations',
    route: 'integrations',
    permissions: all,
    type: 'REGULAR',
    children: [
      { entity: 'config_tokens', label: 'Tokens de Configuração' },
      { entity: 'applications', label: 'Aplicativos' },
    ],
  },
  {
    scope: 'Impressoras',
    entity: 'printer_configs',
    route: 'printer',
    type: 'REGULAR',
    permissions: all,
  },
  {
    scope: 'Operações',
    entity: 'operations',
    route: 'operation',
    type: 'REGULAR',
    permissions: all,
    children: [
      { entity: 'operations_itens', label: 'Itens da operação' },
      { entity: 'operation_comments', label: 'Comentários da operação' },
    ],
  },
   {
    scope: 'Multiplicador Estoque - Inventário',
    entity: 'multiply-stk-inventory',
    route: '',
    type: 'CUSTOM',
    permissions: ['read'],
  },
    {
    scope: 'Multiplicador Estoque - Entradas',
    entity: 'multiply-stk-entrance',
    route: '',
    type: 'CUSTOM',
    permissions: ['read'],
  },
  {
    scope: 'Dados Financeiros',
    entity: 'financial-pdt',
    route: '',
    type: 'CUSTOM',
    permissions: ['read', 'write'],
  },
  {
    scope: 'Todas as Lojas',
    entity: 'visualize-all-unit-business',
    route: '',
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
