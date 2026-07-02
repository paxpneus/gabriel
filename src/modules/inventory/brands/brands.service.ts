import BaseService from "../../../shared/utils/base-models/base-service";
import Brand from "./brands.model";
import brandRepository, { BrandRepository } from "./brands.repository";
import { QueryTypes } from "sequelize";
import sequelize from "../../../config/sequelize";

const BRAND_SIMILARITY_THRESHOLD = 0.3;

export class BrandService extends BaseService<Brand, BrandRepository> {
  constructor() {
    super(brandRepository);

    this.queryConfig = {
      filterableFields: ["id"],
      sortableFields: [
        "name",
        "seller_comission_tax_rate",
        "manager_comission_tax_rate",
        "createdAt",
      ],
      searchFields: ["name"],
      defaults: {
        perPage: 20,
        sortBy: "name",
        sortDir: "ASC",
      },
    };
  }

  async findSimilarBrand(rawName?: string | null): Promise<Brand | null> {
    if (!rawName || !rawName.trim()) return null;

    const normalized = rawName.trim();

    const exact = await Brand.findOne({
      where: sequelize.where(
        sequelize.fn("LOWER", sequelize.col("name")),
        normalized.toLowerCase(),
      ),
    });

    if (exact) return exact;

    const rows = await sequelize.query<{ id: string; sim: number }>(
      `
      SELECT id, similarity(name, :rawName) AS sim
      FROM brands
      WHERE name % :rawName
      ORDER BY sim DESC
      LIMIT 1
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { rawName: normalized },
      },
    );

    if (!rows[0] || rows[0].sim < BRAND_SIMILARITY_THRESHOLD) {
      console.warn(
        `[BrandService] Nenhuma marca parecida o suficiente encontrada para "${normalized}" (melhor sim=${rows[0]?.sim ?? 0})`,
      );
      return null;
    }

    return Brand.findByPk(rows[0].id);
  }
}

export default new BrandService();
