import { z } from "zod";
import { CD21_UNIT_BUSINESS_NUMBER } from "../../../company/unit-business/helpers/cd21-unit-business-number";
import {
  AFFILIATED_USER_TYPE,
  SELLER_USER_TYPE,
} from "../../../../shared/constants/user-types";
import { UserType } from "../../../company/users/user_config/user_config.types";
import {
  AFFILIATED_CONTACT_TYPE,
  ContactCustomData,
  ContactType,
  SELLER_CONTACT_TYPE,
} from "../contacts.types";

export const AFFILIATED_ROLE_NAME = "Afiliado";
export const SELLER_ROLE_NAME = "Vendedor";

export interface ContactUserTypeConfig {
  userType: UserType;
  roleName: string;
  // Tipo com loja fixa ignora unit_business_id do body.
  fixedUnitBusinessNumber?: string;
  customDataSchema?: z.ZodType<ContactCustomData>;
}

/** Tipos de contact que podem ganhar usuário junto. Novo tipo = nova entrada aqui. */
export const CONTACT_USER_TYPE_CONFIG: Partial<Record<ContactType, ContactUserTypeConfig>> = {
  [AFFILIATED_CONTACT_TYPE]: {
    userType: AFFILIATED_USER_TYPE,
    roleName: AFFILIATED_ROLE_NAME,
    fixedUnitBusinessNumber: CD21_UNIT_BUSINESS_NUMBER,
  },
  [SELLER_CONTACT_TYPE]: {
    userType: SELLER_USER_TYPE,
    roleName: SELLER_ROLE_NAME,
  },
};

/** Valida o custom_data pelo schema do tipo; tipo sem schema aceita qualquer objeto. */
export function parseContactCustomData(
  type: ContactType,
  customData: ContactCustomData,
): ContactCustomData {
  const schema = CONTACT_USER_TYPE_CONFIG[type]?.customDataSchema;
  if (!schema) return customData;

  const result = schema.safeParse(customData);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(`custom_data.${issue.path.join(".")}: ${issue.message}`);
  }
  return result.data;
}
