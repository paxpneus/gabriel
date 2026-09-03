import User from "../../../modules/company/users/users/user.model";
import UnitBusiness from "../../../modules/company/unit-business/unit-business.model";

// Resolve o número da filial Tecinco (branchId) a partir da unit_business
// do usuário logado — usado sempre que uma ação precisa saber "em qual
// filial da Tecinco esse usuário está operando" (import de XML manual,
// criação de produto a partir de unmapped, etc).
export async function resolveTecincoBranchId(
  userId: string | undefined,
): Promise<number | undefined> {
  const user = userId
    ? await User.findByPk(userId, { attributes: ["unit_business_id"] })
    : null;

  const unitBusiness = user?.unit_business_id
    ? await UnitBusiness.findByPk(user.unit_business_id, {
        attributes: ["number"],
      })
    : null;

  return unitBusiness?.number ? Number(unitBusiness.number) : undefined;
}
