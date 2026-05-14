import { CreateOptions, FindOptions } from "sequelize";
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
import { CarrierImportLayoutCreationAttributes } from "./carrier-import-layouts.types";
import sequelize from "../../../../config/sequelize";
import carrierLabelRangesService from "../carrier-label-ranges/carrier-label-ranges.service";

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

 async createWithFile(
  data: Partial<CarrierImportLayoutCreationAttributes>,
  options?: CreateOptions,
  file?: { buffer: Buffer; filename: string; mimeType: string }
): Promise<CarrierImportLayout> {
  const alreadyExists = await this.findOne({
    where: { transporter_id: data.transporter_id },
  });

  if (alreadyExists) {
    throw new Error("Esta transportadora já possui um layout de importação!");
  }

  const created = await this.repository.create(data);

  if (file) {
    setImmediate(async () => {
      try {
        await carrierLabelRangesService.importLabelsFromExcel(
          created.transporter_id,
          file,
        );
      } catch (err: any) {
        console.error("[importLabels] background error:", err.message);
      }
    });
  }

  return created; 
}
}

export default new CarrierImportLayoutService();
