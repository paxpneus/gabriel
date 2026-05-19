import { UserUnitBusiness } from "../../../../modules/warehouse";

export async function resolveAllowedUnitBusinessIds(
  userId?: string,
  requestedIds?: string | string[]
): Promise<string[] | undefined> {
  if (!userId) return undefined;

  const userUbs = await UserUnitBusiness.findAll({
    where: { user_id: userId },
    attributes: ["unit_business_id"],
  });

  const allowedIds = userUbs.map((ub) => ub.unit_business_id);

  if (!requestedIds) return allowedIds;

  const requested = Array.isArray(requestedIds) ? requestedIds : [requestedIds];
  const intersected = requested.filter((id) => allowedIds.includes(id));

  return intersected.length > 0 ? intersected : ["__none__"];
}