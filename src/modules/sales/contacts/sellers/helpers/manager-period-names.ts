import { Op } from "sequelize";
import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import unitBusinessGroupService from "../../../../company/unit-business-groups/unit-business-group/unit-business-group.service";
import Contact from "../../contacts.model";
import { ContactAttributes } from "../../contacts.types";

// { name } do id no mapa; null sem id ou id que não existe mais.
function namedRef(names: Map<string, string>, id: string | null): { name: string } | null {
  const name = id ? names.get(id) : undefined;
  if (!name) return null;
  return { name };
}

/** Contato em JSON com `unit_business`/`unit_business_group` ({ name }) em cada período do gerente, pra tabela de períodos do front. */
export async function withManagerPeriodNames(contact: Contact) {
  const json = contact.toJSON() as ContactAttributes;
  const periods = json.custom_data?.manager_periods;
  if (!periods?.length) return json;

  // Uma busca por tabela pra todos os períodos (sem N+1).
  const storeIds = periods.map((period) => period.unit_business_id).filter((id): id is string => !!id);
  const groupIds = periods.map((period) => period.unit_business_group_id).filter((id): id is string => !!id);
  const [stores, groups] = await Promise.all([
    unitBusinessService.findAll({ where: { id: { [Op.in]: storeIds } }, attributes: ["id", "name"] }),
    unitBusinessGroupService.findAll({ where: { id: { [Op.in]: groupIds } }, attributes: ["id", "name"] }),
  ]);
  const storeNames = new Map(stores.map((store) => [store.id, store.name]));
  const groupNames = new Map(groups.map((group) => [group.id, group.name]));

  return {
    ...json,
    custom_data: {
      ...json.custom_data,
      manager_periods: periods.map((period) => ({
        ...period,
        unit_business: namedRef(storeNames, period.unit_business_id),
        unit_business_group: namedRef(groupNames, period.unit_business_group_id),
      })),
    },
  };
}
