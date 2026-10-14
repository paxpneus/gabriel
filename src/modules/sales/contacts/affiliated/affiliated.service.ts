import userService from "../../../company/users/users/user.service";
import { UserAttributes } from "../../../company/users/users/user.types";
import { AFFILIATED_USER_TYPE } from "../../../../shared/constants/user-types";
import { AffiliatedProfile } from "./affiliated.types";

export class AffiliatedService {
  private toProfile(user: UserAttributes & { unitBusiness?: { number?: string | null; name?: string | null } }): AffiliatedProfile {
    return {
      name: user.name,
      unit_business: {
        number: user.unitBusiness?.number ?? null,
        name: user.unitBusiness?.name ?? null,
      },
    };
  }

  async login(email: string, password: string): Promise<{ token: string; profile: AffiliatedProfile }> {
    const { token, user } = await userService.loginAs(email, password, AFFILIATED_USER_TYPE);
    return { token, profile: this.toProfile(user) };
  }

  async getMe(token: string): Promise<AffiliatedProfile> {
    const user = await userService.getMe(token);
    if (user.type !== AFFILIATED_USER_TYPE) throw new Error("Usuário sem acesso a este login");
    return this.toProfile(user);
  }
}

export default new AffiliatedService();
