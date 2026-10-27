import userService from "../../../company/users/users/user.service";
import { UserAttributes } from "../../../company/users/users/user.types";
import { AFFILIATED_USER_TYPE } from "../../../../shared/constants/user-types";

// Affiliated login/me: reuses UserService auth but only exposes a lean profile (name + store).
export class AffiliatedService {
  // Login restricted to affiliated users; the default /users/login refuses them.
  async login(email: string, password: string) {
    const { token, user } = await userService.loginAs(email, password, AFFILIATED_USER_TYPE);
    return { token, profile: this.toProfile(user) };
  }

  // Resolves the session user and rejects anyone who is not affiliated.
  async getMe(token: string) {
    const user = await userService.getMe(token);
    if (user.type !== AFFILIATED_USER_TYPE) throw new Error("Usuário sem acesso a este login");
    return this.toProfile(user);
  }

  // getFullUser includes unitBusiness (number, name), not declared on UserAttributes.
  private toProfile(
    user: UserAttributes & { unitBusiness?: { number?: string | null; name?: string | null } | null },
  ): { name: string; unit_business: { number: string | null; name: string | null } } {
    return {
      name: user.name,
      unit_business: {
        number: user.unitBusiness?.number ?? null,
        name: user.unitBusiness?.name ?? null,
      },
    };
  }
}

export default new AffiliatedService();
