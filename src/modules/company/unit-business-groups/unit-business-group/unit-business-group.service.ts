import { DestroyOptions } from "sequelize";
import BaseService from "../../../../shared/utils/base-models/base-service";
// Fachada do core de contacts (a da entidade puxa sellers → unit-business.service → este service: ciclo).
import { contactService } from "../../../sales/contacts/core";
import { UnitBusinessGroupInUseError } from "./unit-business-group.types";
import UnitBusinessGroup from "./unit-business-group.model";
import unitBusinessGroupRepository, {
  UnitBusinessGroupRepository,
} from "./unit-business-group.repository";

export class UnitBusinessGroupService extends BaseService<
  UnitBusinessGroup,
  UnitBusinessGroupRepository
> {
  constructor() {
    super(unitBusinessGroupRepository);

    this.queryConfig = {
      filterableFields: ["id", "name"],
      sortableFields: ["createdAt", "name"],
      searchFields: ["name", "description"],
      defaults: {
        perPage: 20,
        sortBy: "name",
        sortDir: "ASC",
      },
    };
  }

  getFullById(id: string) {
    return this.repository.getFullById(id);
  }

  /** Recusa apagar grupo usado em período de gerente: os membros saem em cascata e o regional perderia todo o histórico. */
  async delete(id: string, options?: DestroyOptions) {
    await this.assertNotInManagerPeriods([id]);
    return super.delete(id, options);
  }

  /** Mesma trava do delete pra exclusão em lote. */
  async bulkDelete(options: DestroyOptions) {
    const groups = await this.repository.findAll({ where: options.where, attributes: ["id"] });
    await this.assertNotInManagerPeriods(groups.map((group) => group.id));
    return super.bulkDelete(options);
  }

  // Barra se algum dos grupos aparece em período de gerente (vigente ou passado).
  private async assertNotInManagerPeriods(groupIds: string[]) {
    const names = await contactService.findManagerNamesByPeriodGroups(groupIds);
    if (names.length) {
      throw new UnitBusinessGroupInUseError(
        `Este grupo de lojas está nos períodos de gerente de ${names.join(", ")} e não pode ser apagado: o histórico de comissão de gerente regional sumiria.`,
      );
    }
  }
}

export default new UnitBusinessGroupService();
