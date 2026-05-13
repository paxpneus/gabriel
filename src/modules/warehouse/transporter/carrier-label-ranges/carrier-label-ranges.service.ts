import { FindOptions } from "sequelize";
import {
  PaginatedResult,
  QueryParams,
} from "../../../../shared/query/query.types";
import BaseService from "../../../../shared/utils/base-models/base-service";
import Transporter from "../transporter.model";
import CarrierLabelRange from "./carrier-label-ranges.model";
import carrierLabelRangeRepository, {
  CarrierLabelRangeRepository,
} from "./carrier-label-ranges.repository";
import sequelize from "../../../../config/sequelize";
import carrierImportLayoutsService from "../carrier-import-layouts/carrier-import-layouts.service";

export class CarrierLabelRangeService extends BaseService<
  CarrierLabelRange,
  CarrierLabelRangeRepository
> {
  constructor() {
    super(carrierLabelRangeRepository);

    this.queryConfig = {
      defaults: { perPage: 20, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: [
        "cep_start",
        "cep_end",
        "route_acronym",
        "service_name",
        "route_code",
        "transporter_code",
      ],
      filterableFields: ["transporter_id", "active"],
      sortableFields: [
        "cep_start",
        "cep_end",
        "route_acronym",
        "service_name",
        "route_code",
        "transporter_code",
        "active",
        "createdAt",
        "updatedAt",
      ],
    };
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<CarrierLabelRange>> {
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

  async importLabelsFromExcel(transporter_id: string,  file: { buffer: Buffer, filename: string, mimeType: string }) {
    return sequelize.transaction(async (t) => {
      const importLayout = await carrierImportLayoutsService.findOne({
        where: {
          transporter_id: transporter_id,
        },
        transaction: t
      })

      if (!importLayout) {
        throw new Error("O transportador deve ter um layout de importação!")
      }
    })
  }
}

export default new CarrierLabelRangeService();
