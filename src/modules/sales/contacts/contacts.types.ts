// Type-only (apagado no build): não carrega a fachada de sellers em runtime, sem ciclo com o model.
import type { ManagerPeriod } from "./sellers";

// SELLER_MANAGER = gerente de loja e/ou regional (lojas/grupos por período em custom_data.manager_periods); também é vendedor (pode vender no Bling).
export type ContactType = "SELLER" | "SELLER_MANAGER" | "CUSTOMER";

export const SELLER_MANAGER_CONTACT_TYPE: ContactType = "SELLER_MANAGER";

/** Tipos que contam como vendedor (busca do vendedor do Bling, escopo de vendedor); gerente também vende. */
export const SELLER_CONTACT_TYPES: ContactType[] = ["SELLER", SELLER_MANAGER_CONTACT_TYPE];

/** Vendedor genérico do Bling (pedido sem vendedor de verdade, ex.: marketplace) — não conta como vendedor válido. */
export const UNASSIGNED_SELLER_NAME = "Vendedor 0";

/** Valores customizados por `type` do contato. SELLER_MANAGER: `manager_periods` (sem período não ganha comissão de gerente). */
export interface ContactCustomData {
  manager_periods?: ManagerPeriod[];
}

export interface ContactAttributes {
  id: string;
  name: string;
  type: ContactType;
  id_system: string;
  document?: string | null;
  integrations_id?: string | null;
  unit_business_id?: string | null;
  // Grupo de lojas do gerente regional (cadastro atual); a comissão usa o grupo de cada período em custom_data.manager_periods.
  unit_business_group_id?: string | null;
  user_id?: string | null;
  custom_data?: ContactCustomData | null;
}

export type ContactCreationAttributes = Omit<ContactAttributes, "id">;
