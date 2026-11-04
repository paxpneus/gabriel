import { SELLER_MANAGER_CONTACT_TYPE } from "../contacts.types";

/** FROM/WHERE dos gerentes da loja (`manager`): contato SELLER_MANAGER com `unit_business_id` = loja. Usar com SELECT ou EXISTS. */
export function storeManagersFromSql(unitBusinessIdSql: string): string {
  return `
    FROM contacts manager
    WHERE manager.type = '${SELLER_MANAGER_CONTACT_TYPE}'
      AND manager.unit_business_id = ${unitBusinessIdSql}`;
}

/** FROM/WHERE dos regionais da loja (`manager`): SELLER_MANAGER cujo grupo tem a loja, menos quem já é gerente dela (ganha uma vez só). */
export function regionalManagersFromSql(unitBusinessIdSql: string): string {
  return `
    FROM contacts manager
    JOIN unit_business_group_members member ON member.unit_business_group_id = manager.unit_business_group_id
    WHERE manager.type = '${SELLER_MANAGER_CONTACT_TYPE}'
      AND member.unit_business_id = ${unitBusinessIdSql}
      AND manager.unit_business_id IS DISTINCT FROM ${unitBusinessIdSql}`;
}
