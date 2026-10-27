// Contact types accepted by the enum_contacts_type column (single source for model + Zod schema).
export const CONTACT_TYPES = ["SELLER", "CUSTOMER", "AFFILIATED"] as const;

export type ContactType = (typeof CONTACT_TYPES)[number];

// Affiliated seller: own login, always store 21, earns a frozen commission per coupon.
export const AFFILIATED_CONTACT_TYPE: ContactType = "AFFILIATED";
export const SELLER_CONTACT_TYPE: ContactType = "SELLER";

// Generic free-form JSONB bag; PUT merges keys instead of replacing.
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
