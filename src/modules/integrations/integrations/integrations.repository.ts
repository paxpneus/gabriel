import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Integration from "./integrations.model";
import UnitBusiness from "../../company/unit-business/unit-business.model";

export class IntegrationRepository extends BaseRepository<Integration> {
    constructor() { super(Integration) }

    // Associação reversa: acha a Integration a partir do unit business que aponta pra ela.
    async findByUnitBusinessId(unitBusinessId: string): Promise<Integration | null> {
        return this.findOne({
            include: [
                {
                    model: UnitBusiness,
                    as: "unitBusiness",
                    where: { id: unitBusinessId },
                    required: true,
                },
            ],
        });
    }
}
export default new IntegrationRepository();