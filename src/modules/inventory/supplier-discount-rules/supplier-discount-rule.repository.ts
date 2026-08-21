import { QueryTypes, Transaction } from "sequelize";
import sequelize from "../../../config/sequelize";
import BaseRepository from "../../../shared/utils/base-models/base-repository";
import SupplierDiscountRule from "./supplier-discount-rule.model";
import {
  SupplierDiscountCandidateRow,
  SupplierDiscountResolveItemInput,
  SupplierDiscountType,
} from "./supplier-discount-rule.types";

interface FindOverlappingParams {
  discountType: SupplierDiscountType;
  startDate: Date;
  endDate: Date;
  brandIds: string[];
  rimIds: string[];
  measureIds: string[];
  unitBusinessIds: string[];
}

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export class SupplierDiscountRuleRepository extends BaseRepository<SupplierDiscountRule> {
  constructor() {
    super(SupplierDiscountRule);
  }

  // Só bloqueia quando PERCENTUAL está envolvida (a candidata OU a regra já
  // existente). REAL nunca bloqueia REAL — é assim que níveis por
  // quantidade coexistem no mesmo escopo. Loja exige interseção real (nunca
  // curinga); marca/aro/medida casam se qualquer um dos dois lados for
  // curinga (lista vazia) ou se houver interseção de fato.
  async findOverlapping(
    params: FindOverlappingParams,
    excludeRuleId?: string,
    options?: { transaction?: Transaction },
  ): Promise<{ id: string } | null> {
    const rows = await sequelize.query<{ id: string }>(
      `
      SELECT r.id
      FROM supplier_discount_rules r
      WHERE r.active = true
        AND r.id != CAST(:excludeRuleId AS uuid)
        AND r.start_date <= CAST(:endDate AS timestamp)
        AND r.end_date >= CAST(:startDate AS timestamp)
        AND (CAST(:discountType AS varchar) = 'PERCENTUAL' OR r.discount_type = 'PERCENTUAL')
        AND EXISTS (
          SELECT 1 FROM supplier_discount_unit_businesses x
          WHERE x.supplier_discount_rule_id = r.id
            AND x.unit_business_id = ANY(ARRAY[:unitBusinessIds]::uuid[])
        )
        AND (
          cardinality(ARRAY[:brandIds]::uuid[]) = 0
          OR NOT EXISTS (SELECT 1 FROM supplier_discount_rule_brands x WHERE x.supplier_discount_rule_id = r.id)
          OR EXISTS (SELECT 1 FROM supplier_discount_rule_brands x WHERE x.supplier_discount_rule_id = r.id AND x.brand_id = ANY(ARRAY[:brandIds]::uuid[]))
        )
        AND (
          cardinality(ARRAY[:rimIds]::uuid[]) = 0
          OR NOT EXISTS (SELECT 1 FROM supplier_discount_rule_rims x WHERE x.supplier_discount_rule_id = r.id)
          OR EXISTS (SELECT 1 FROM supplier_discount_rule_rims x WHERE x.supplier_discount_rule_id = r.id AND x.rim_id = ANY(ARRAY[:rimIds]::uuid[]))
        )
        AND (
          cardinality(ARRAY[:measureIds]::uuid[]) = 0
          OR NOT EXISTS (SELECT 1 FROM supplier_discount_rule_measures x WHERE x.supplier_discount_rule_id = r.id)
          OR EXISTS (SELECT 1 FROM supplier_discount_rule_measures x WHERE x.supplier_discount_rule_id = r.id AND x.measure_id = ANY(ARRAY[:measureIds]::uuid[]))
        )
      LIMIT 1
      `,
      {
        type: QueryTypes.SELECT,
        transaction: options?.transaction,
        replacements: {
          excludeRuleId: excludeRuleId ?? NIL_UUID,
          startDate: params.startDate,
          endDate: params.endDate,
          discountType: params.discountType,
          brandIds: params.brandIds,
          rimIds: params.rimIds,
          measureIds: params.measureIds,
          unitBusinessIds: params.unitBusinessIds,
        },
      },
    );

    return rows[0] ?? null;
  }

  // Retorna as regras CANDIDATAS por item (0-N linhas por item) — a
  // decomposição em blocos/níveis fica a cargo do service (resolveForItems),
  // não é feita aqui.
  async matchBatch(
    items: SupplierDiscountResolveItemInput[],
  ): Promise<SupplierDiscountCandidateRow[]> {
    if (!items.length) return [];

    return sequelize.query<SupplierDiscountCandidateRow>(
      `
      SELECT batch.order_item_id, r.id AS rule_id, r.discount_type, r.quantity_step, r.discount_value
      FROM unnest(
        ARRAY[:orderItemIds]::uuid[], ARRAY[:brandIds]::uuid[], ARRAY[:rimIds]::uuid[], ARRAY[:measureIds]::uuid[],
        ARRAY[:unitBusinessIds]::uuid[], ARRAY[:orderDates]::timestamp[]
      ) AS batch(order_item_id, brand_id, rim_id, measure_id, unit_business_id, order_date)
      JOIN supplier_discount_rules r
        ON r.active = true
        AND batch.order_date BETWEEN r.start_date AND r.end_date
        AND EXISTS (
          SELECT 1 FROM supplier_discount_unit_businesses x
          WHERE x.supplier_discount_rule_id = r.id AND x.unit_business_id = batch.unit_business_id
        )
        AND (
          NOT EXISTS (SELECT 1 FROM supplier_discount_rule_brands x WHERE x.supplier_discount_rule_id = r.id)
          OR EXISTS (SELECT 1 FROM supplier_discount_rule_brands x WHERE x.supplier_discount_rule_id = r.id AND x.brand_id = batch.brand_id)
        )
        AND (
          NOT EXISTS (SELECT 1 FROM supplier_discount_rule_rims x WHERE x.supplier_discount_rule_id = r.id)
          OR EXISTS (SELECT 1 FROM supplier_discount_rule_rims x WHERE x.supplier_discount_rule_id = r.id AND x.rim_id = batch.rim_id)
        )
        AND (
          NOT EXISTS (SELECT 1 FROM supplier_discount_rule_measures x WHERE x.supplier_discount_rule_id = r.id)
          OR EXISTS (SELECT 1 FROM supplier_discount_rule_measures x WHERE x.supplier_discount_rule_id = r.id AND x.measure_id = batch.measure_id)
        )
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          orderItemIds: items.map((i) => i.order_item_id),
          brandIds: items.map((i) => i.brand_id),
          rimIds: items.map((i) => i.rim_id),
          measureIds: items.map((i) => i.measure_id),
          unitBusinessIds: items.map((i) => i.unit_business_id),
          orderDates: items.map((i) => i.order_date),
        },
      },
    );
  }
}

export default new SupplierDiscountRuleRepository();
