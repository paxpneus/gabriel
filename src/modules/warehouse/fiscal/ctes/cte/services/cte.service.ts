import { literal, where as sequelizeWhere, Op } from "sequelize";
import BaseService from "../../../../../../shared/utils/base-models/base-service";
import Cte from "../cte.model";
import cteRepository, { CteRepository } from "../cte.repository";

export class CteService extends BaseService<Cte, CteRepository> {
  constructor() {
    super(cteRepository);

    this.queryConfig = {
      defaults: { perPage: 50, sortBy: "createdAt", sortDir: "DESC" },

      stringFields: [
        "taker_tax_id",
        "receiver_tax_id",
        "sender_tax_id",
        "recipient_tax_id",
        "dispatcher_tax_id",
        "number",
        "xml_key",
      ],
      searchFields: ["number", "xml_key"],
      numericSearchFields: ["number"],
      filterableFields: [
        "taker_tax_id",
        "receiver_tax_id",
        "sender_tax_id",
        "recipient_tax_id",
        "dispatcher_tax_id",
        "issue_date",
      ],
      sortableFields: ["createdAt", "issue_date", "number"],
      customFields: {
        issue_date: (value) => {
          const { start, end } = (value ?? {}) as {
            start?: string;
            end?: string;
          };

          const range: Record<symbol, any> = {};

          if (start) {
            range[Op.gte] = literal(
              `('${start}'::date AT TIME ZONE 'America/Sao_Paulo')`,
            );
          }

          if (end) {
            range[Op.lt] = literal(
              `(('${end}'::date + INTERVAL '1 day') AT TIME ZONE 'America/Sao_Paulo')`,
            );
          }

          if (!start && !end) return {};

          return {
            [Op.and]: [sequelizeWhere(literal(`"issue_date"`), range)],
          };
        },
      },
    };
  }
}

export default new CteService();
