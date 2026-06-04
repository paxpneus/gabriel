import { UserType } from "../../modules/warehouse/users/user_config/user_config.types";

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
  permissions?: PermissionNode[];
}

export interface USER_TYPE_CONFIG {
  type: UserType;
  modules: Module[] | "*";
  initialPage: string; 
}

export const USER_TYPES: USER_TYPE_CONFIG[] = [
  {
    type: "admin",
    modules: "*",
    initialPage: "operation-report",
  },

  {
    type: "operator",
    initialPage: "home",
    modules: [
      {
        module: "sales",
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
        permissions: [
          {
            id: "transporters",
            label: "Transportadoras",
          },
        ],
      },

      {
        module: "stock",
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
        permissions: [
          {
            id: "invoices-report",
            label: "Relatório de Notas Fiscais",
          },
        ],
      },

      {
        module: "transfers",
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
    initialPage: "/unit-business-request",
    modules: [
      {
        module: "transfers",
        permissions: [
          {
            id: "unit-business-request",
            label: "Transferências",
          },
        ],
      },
    ],
  },
];