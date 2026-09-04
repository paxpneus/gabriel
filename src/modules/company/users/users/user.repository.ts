import { FindOptions } from "sequelize";
import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import User from "./user.model";
import UnitBusiness from "../../unit-business/unit-business.model";
import UserConfig from "../user_config/user_config.model";
import { USER_TYPES } from "../../../../shared/constants/user-types";
import { UserAttributes } from "./user.types";
import Role from "../roles/role.model";
import Contact from "../../../sales/contacts/contacts.model";
import UnitBusinessConfig from "../../unit-business/unit-business-config/unit-business-config.model";
import Label from "../../../inventory/labels/labels.model";

export class UserRepository extends BaseRepository<User> {
  constructor() {
    super(User);
  }

  async getFullUser(options?: FindOptions): Promise<UserAttributes | null> {
    const userResponse = await super.findOne({
      ...options,
      include: [
        {
          model: Role,
          as: "role",
        },
        {
          model: UnitBusiness,
          as: "unitBusiness",
          attributes: ["id", "name", "number", "integrations_id", "id_system", "cnpj"],
          include: [
            {
              model: UnitBusinessConfig,
              as: 'config',
              include: [
                {
                  model: Label,
                  as: 'stockLabel'
                },
                {
                  model: Label,
                  as: 'shippingLabel'
                }
              ]
            }
          ]
        },
        {
          model: UnitBusiness,
          as: "availableUnitBusinesses",
          attributes: ["id", "name", "number", "id_system", "cnpj"],
        },
        {
          model: UserConfig,
          as: "config",
        },
        {
          model: Contact,
          as: "contact",
        },
      ],
    });

    if (!userResponse) {
      return null;
    }

    const plainUser = userResponse.get({ plain: true }) as UserAttributes;

    const allowedModules = USER_TYPES.find(
      (tp) => tp.type === plainUser.config?.type,
    );

    const businessToView = plainUser.config
      ?.visualize_only_current_unit_business
      ? plainUser.unit_business_id
      : (plainUser.availableUnitBusinesses?.map((u) => u.id) ?? []);

    return {
      ...plainUser,
      businessToView,
      allowedModules,
      config: plainUser.config
        ? {
            ...plainUser.config,
            type_permissions: allowedModules,
          }
        : undefined,
    };
  }

  async findById(id: string, options?: FindOptions): Promise<User | null> {
    return super.findById(id, {
      include: [
        {
          model: UnitBusiness,
          as: "availableUnitBusinesses",
        },
        {
          model: UserConfig,
          as: "config",
        },
      ],
    });
  }
}

export default new UserRepository();
