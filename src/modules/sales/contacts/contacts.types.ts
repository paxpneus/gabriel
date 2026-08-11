export type ContactType = "SELLER" | "CUSTOMER";

export interface ContactAttributes {
  id: string;
  name: string;
  type: ContactType;
  id_system: string;
  document: string;
  integrations_id?: string | null;
  unit_business_id?: string | null;
  user_id?: string | null;
}

export type ContactCreationAttributes = Omit<ContactAttributes, "id">;
