// SELLER_MANAGER = gerente da loja (unit_business_id); também é vendedor (pode vender no Bling).
export type ContactType = "SELLER" | "SELLER_MANAGER" | "CUSTOMER";

export const SELLER_MANAGER_CONTACT_TYPE: ContactType = "SELLER_MANAGER";

/** Tipos que contam como vendedor (busca do vendedor do Bling, escopo de vendedor); gerente também vende. */
export const SELLER_CONTACT_TYPES: ContactType[] = ["SELLER", SELLER_MANAGER_CONTACT_TYPE];

export interface ContactAttributes {
  id: string;
  name: string;
  type: ContactType;
  id_system: string;
  document?: string | null;
  integrations_id?: string | null;
  unit_business_id?: string | null;
  user_id?: string | null;
}

export type ContactCreationAttributes = Omit<ContactAttributes, "id">;
