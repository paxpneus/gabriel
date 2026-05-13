import { FindOptions } from "sequelize";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../shared/query/query.types";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Transporter from "../transporter.model";
import CarrierImportLayout from "./carrier-import-layouts.model";
import carrierImportLayoutRepository, {
  CarrierImportLayoutRepository,
} from "./carrier-import-layouts.repository";

export class CarrierImportLayoutService extends BaseService<
  CarrierImportLayout,
  CarrierImportLayoutRepository
> {
  constructor() {
    super(carrierImportLayoutRepository);

    this.queryConfig = {
      defaults: { perPage: 20, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: [
        "name",
        "type",
        "sheet_name",
        "mapping_mode",
        "zip_from_label",
        "zip_to_label",
        "route_code_label",
        "destination_label",
        "observation_label",
      ],
      filterableFields: ["transporter_id", "type", "mapping_mode", "active"],
      sortableFields: [
        "name",
        "type",
        "sheet_name",
        "data_start_row",
        "mapping_mode",
        "active",
        "createdAt",
        "updatedAt",
      ],
    };
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<CarrierImportLayout>> {
    return super.paginate(params, {
      ...extraOptions,
      include: [
        {
          model: Transporter,
          as: "transporter",
        },
      ],
    });
  }
}

export default new CarrierImportLayoutService();
