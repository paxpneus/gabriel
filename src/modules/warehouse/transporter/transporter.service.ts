import { FindOptions } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import Transporter from "./transporter.model";
import transporterRepository, {
  TransporterRepository,
} from "./transporter.repository";
import CarrierImportLayout from "./carrier-import-layouts/carrier-import-layouts.model";
import {
  QueryParams,
  PaginatedResult,
} from "../../../shared/query/query.types";

export class TransporterService extends BaseService<
  Transporter,
  TransporterRepository
> {
  constructor() {
    super(transporterRepository);

    this.queryConfig = {
      defaults: { perPage: 50, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: ["name"],
      sortableFields: ["createdAt"],
    };
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<Transporter>> {
    const transporters = await super.paginate(params, extraOptions);

    return {
      ...transporters,
      data: transporters.data.map((t) => ({
        ...t.get({ plain: true }),
        name: [t.name, t.uf, t.cnpj].filter(Boolean).join(" | "),
      })) as unknown as Transporter[],
    };
  }

  async findById(
    id: string,
    options?: FindOptions,
  ): Promise<Transporter | null> {
    return await this.repository.findById(id, {
      include: [
        {
          model: CarrierImportLayout,
          as: "importLayout",
        },
      ],
    });
  }
}

export default new TransporterService();
