import { UserType } from "../../modules/company/users/user_config/user_config.types";

export type ModulesOptions =
  | "sales"
  | "expedition"
  | "logistics"
  | "stock"
  | "reports"
  | "transfers";

export interface PermissionNode {
  id: string;
  label?: string;
  children?: PermissionNode[];
}

export interface Module {
  module: ModulesOptions;
  label: string;
  permissions?: PermissionNode[];
}

export interface USER_TYPE_CONFIG {
  type: UserType;
  label: string;
  description?: string;
  modules: Module[] | "*";
  initialPage: string;
}

export const USER_TYPES: USER_TYPE_CONFIG[] = [
  {
    type: "admin",
    label: "Administrador",
    description: "Acesso completo a todos os módulos e telas do sistema.",
    modules: "*",
    initialPage: "daily-operation-report",
  },

  {
    type: "operator",
    label: "Operador",
    description:
      "Acesso operacional a vendas, expedição, estoque, logística, relatórios e transferências.",
    initialPage: "daily-operation-report",
    modules: [
      {
        module: "sales",
        label: "Vendas",
        permissions: [
          {
            id: "sales_invoice",
            label: "Notas Fiscais de Saída",
            children: [
              {
                id: "outgoing-invoices",
                label: "Notas Fiscais de Saída",
              },
            ],
          },
        ],
      },

      {
        module: "expedition",
        label: "Expedição",
        permissions: [
          {
            id: "expedition_batches",
            label: "Lotes de Expedição",
          },
          {
            id: "delivery_notes",
            label: "Romaneios",
          },
        ],
      },

      {
        module: "logistics",
        label: "Logística",
        permissions: [
          {
            id: "transporters",
            label: "Transportadoras",
          },
          {
            id: "ctes",
            label: "Documento Fiscal CTE",
          },
        ],
      },

      {
        module: "stock",
        label: "Estoque",
        permissions: [
          {
            id: "incoming_invoices_group",
            label: "Notas Fiscais de Entrada",
            children: [
              {
                id: "incoming_invoices_returning",
                label: "Notas Fiscais de Devolução",
              },
              {
                id: "incoming_invoices",
                label: "Notas Fiscais de Entrada",
              },
              {
                id: "incoming_invoices_schedule",
                label: "Agendamento de NF de Entrada",
              },
              {
                id: "incoming_invoices_schedule_ret",
                label: "Agendamento de NF de Devolução",
              },
              {
                id: "incoming_batches",
                label: "Lotes de Entrada",
              },
            ],
          },
          {
            id: "unmapped-products",
            label: "Produtos Não Mapeados",
          },
          {
            id: "inventory_batches",
            label: "Inventário de Estoque",
          },
          {
            id: "products",
            label: "Produtos",
          },
        ],
      },

      {
        module: "reports",
        label: "Relatórios",
        permissions: [
          {
            id: "invoices-report",
            label: "Relatório de Notas Fiscais",
          },
          {
            id: "daily-operation-report",
            label: "Relatório de Operação",
          },
        ],
      },

      {
        module: "transfers",
        label: "Transferências",
        permissions: [
          {
            id: "unit-business-request",
            label: "Transferências",
          },
        ],
      },
    ],
  },

  {
    type: "stock-requester",
    label: "Solicitante de Estoque",
    description: "Acesso restrito à solicitação de transferências de estoque.",
    initialPage: "/unit-business-request",
    modules: [
      {
        module: "transfers",
        label: "Transferências",
        permissions: [
          {
            id: "unit-business-request",
            label: "Transferências",
          },
        ],
      },
    ],
  },
  {
    type: "manager",
    label: "Gerente",
    description: "Acesso ao relatório de vendedores - visão gerencial.",
    initialPage: "sellers-manager-report",
    modules: [
      {
        module: "reports",
        label: "Relatórios",
        permissions: [
          {
            id: "seller-manager-report",
            label: "Relatório de Vendedor - Visão Gerencial",
          },
        ],
      },
    ],
  },

  {
    type: "seller",
    label: "Vendedor",
    description: "Acesso ao relatório de vendedores - visão vendedor.",
    initialPage: "sellers-report",
    modules: [
      {
        module: "reports",
        label: "Relatórios",
        permissions: [
          {
            id: "seller-report",
            label: "Relatório de Vendedor - Visão Vendedor",
          },
        ],
      },
    ],
  },
];