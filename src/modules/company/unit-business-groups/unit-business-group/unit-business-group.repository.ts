import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import UnitBusiness from "../../unit-business/unit-business.model";
import UnitBusinessGroup from "./unit-business-group.model";

export class UnitBusinessGroupRepository extends BaseRepository<UnitBusinessGroup> {
  constructor() {
    super(UnitBusinessGroup);
  }

  getFullById(id: string): Promise<UnitBusinessGroup | null> {
    return this.findById(id, {
      attributes: ["id", "name", "description", "createdAt", "updatedAt"],
      include: [
        {
          model: UnitBusiness,
          as: "unitBusinesses",
          attributes: ["id", "number", "name"],
          through: { attributes: ["id"] },
        },
      ],
      order: [[{ model: UnitBusiness, as: "unitBusinesses" }, "name", "ASC"]],
    });
  }
}

export default new UnitBusinessGroupRepository();
