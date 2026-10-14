export const CONTACT_TYPES = ["SELLER", "CUSTOMER", "AFFILIATED"] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

export const AFFILIATED_CONTACT_TYPE: ContactType = "AFFILIATED";
export const SELLER_CONTACT_TYPE: ContactType = "SELLER";

// Formato livre por tipo; cada tipo valida o seu em helpers/contact-user-types.ts.
export type ContactCustomData = Record<string, unknown>;


export interface ContactAttributes {
  id: string;
  name: string;
  type: ContactType;
  id_system?: string | null;
  document?: string | null;
  integrations_id?: string | null;
  unit_business_id?: string | null;
  user_id?: string | null;
  custom_data?: ContactCustomData | null;
}

export type ContactCreationAttributes = Omit<ContactAttributes, "id">;
