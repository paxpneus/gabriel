import { literal, where as sequelizeWhere, Op } from "sequelize";
import BaseService from "../../../../../../shared/utils/base-models/base-service";
import Cte from "../cte.model";
import cteRepository, { CteRepository } from "../cte.repository";

const CLOUD_ARCHIVE_UPDATE_CHUNK = 1000;

export class CteService extends BaseService<Cte, CteRepository> {
  constructor() {
    super(cteRepository);

    this.queryConfig = {
      defaults: { perPage: 50, sortBy: "createdAt", sortDir: "DESC" },

      stringFields: [
        "taker_tax_id",
        "receiver_tax_id",
        "sender_tax_id",
        "issuer_tax_id",
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
        "issuer_tax_id",
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

  async findUnsyncedTakenByCnpjs(cnpjs: string[]): Promise<Cte[]> {
    if (!cnpjs.length) return [];

    return this.findAll({
      where: {
        taker_tax_id: { [Op.in]: cnpjs },
        synched: false,
      },
    });
  }

  async markAsSynched(id: string): Promise<void> {
    await this.update(id, { synched: true });
  }

  // Só CT-es com XML guardado: sem xml_path não há o que arquivar.
  async findPendingCloudArchive(): Promise<{ id: string; number: number }[]> {
    const rows = await this.findAll({
      where: { cloud_path: null, xml_path: { [Op.ne]: null } },
      attributes: ["id", "number"],
      order: [["createdAt", "DESC"]],
    });

    return rows.map((row) => ({ id: row.id, number: row.number }));
  }

  async markCloudArchived(ids: string[], normalizedDirectory: string): Promise<void> {
    for (let i = 0; i < ids.length; i += CLOUD_ARCHIVE_UPDATE_CHUNK) {
      await this.repository.markCloudArchived(
        ids.slice(i, i + CLOUD_ARCHIVE_UPDATE_CHUNK),
        normalizedDirectory,
      );
    }
  }

  async findExistingXmlKeys(xmlKeys: string[]): Promise<Set<string>> {
    if (!xmlKeys.length) return new Set();

    const rows = await this.findAll({
      where: { xml_key: { [Op.in]: xmlKeys } },
      attributes: ["xml_key"],
    });

    return new Set(rows.map((row) => row.xml_key));
  }
}

export default new CteService();
