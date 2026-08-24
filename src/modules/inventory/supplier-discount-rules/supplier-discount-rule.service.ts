import { Transaction } from "sequelize";
import BaseService from "../../../shared/utils/base-models/base-service";
import { PaginatedResult, QueryParams } from "../../../shared/query/query.types";
import SupplierDiscountRule from "./supplier-discount-rule.model";
import supplierDiscountRuleRepository, {
  SupplierDiscountRuleRepository,
} from "./supplier-discount-rule.repository";
import supplierDiscountRuleBrandService from "../supplier-discount-rule-brands/supplier-discount-rule-brand.service";
import supplierDiscountRuleRimService from "../supplier-discount-rule-rims/supplier-discount-rule-rim.service";
import supplierDiscountRuleMeasureService from "../supplier-discount-rule-measures/supplier-discount-rule-measure.service";
import supplierDiscountUnitBusinessService from "../supplier-discount-unit-businesses/supplier-discount-unit-business.service";
import SupplierDiscountRuleBrand from "../supplier-discount-rule-brands/supplier-discount-rule-brand.model";
import SupplierDiscountRuleRim from "../supplier-discount-rule-rims/supplier-discount-rule-rim.model";
import SupplierDiscountRuleMeasure from "../supplier-discount-rule-measures/supplier-discount-rule-measure.model";
import SupplierDiscountUnitBusiness from "../supplier-discount-unit-businesses/supplier-discount-unit-business.model";
import {
  SupplierDiscountCandidateRow,
  SupplierDiscountResolveItemInput,
  SupplierDiscountResolveResult,
  SupplierDiscountRuleDetail,
  SupplierDiscountRuleInput,
} from "./supplier-discount-rule.types";

// Include usado tanto por findById (show) quanto por paginate (index) — as
// 4 pivôs, só a coluna do alvo (o resto do pivô — id/timestamps — não
// interessa pro front).
const SCOPE_INCLUDE = [
  {
    model: SupplierDiscountRuleBrand,
    as: "ruleBrands",
    attributes: ["brand_id"],
  },
  { model: SupplierDiscountRuleRim, as: "ruleRims", attributes: ["rim_id"] },
  {
    model: SupplierDiscountRuleMeasure,
    as: "ruleMeasures",
    attributes: ["measure_id"],
  },
  {
    model: SupplierDiscountUnitBusiness,
    as: "ruleUnitBusinesses",
    attributes: ["unit_business_id"],
  },
];

const toDetail = (rule: SupplierDiscountRule): SupplierDiscountRuleDetail => {
  const json = rule.toJSON() as any;
  return {
    id: json.id,
    quantity_step: json.quantity_step,
    discount_type: json.discount_type,
    discount_value: json.discount_value,
    start_date: json.start_date,
    end_date: json.end_date,
    active: json.active,
    brand_ids: (json.ruleBrands ?? []).map((r: any) => r.brand_id),
    rim_ids: (json.ruleRims ?? []).map((r: any) => r.rim_id),
    measure_ids: (json.ruleMeasures ?? []).map((r: any) => r.measure_id),
    unit_business_ids: (json.ruleUnitBusinesses ?? []).map(
      (r: any) => r.unit_business_id,
    ),
    createdAt: json.createdAt,
    updatedAt: json.updatedAt,
  };
};

const groupBy = <T, K extends string>(
  items: T[],
  keyFn: (item: T) => K,
): Record<K, T[]> => {
  const result = {} as Record<K, T[]>;
  for (const item of items) {
    const key = keyFn(item);
    (result[key] ??= []).push(item);
  }
  return result;
};

const round2 = (value: number): number => Math.round(value * 100) / 100;

export class SupplierDiscountRuleService extends BaseService<
  SupplierDiscountRule,
  SupplierDiscountRuleRepository
> {
  constructor() {
    super(supplierDiscountRuleRepository);

    this.queryConfig = {
      filterableFields: ["discount_type", "active"],
      sortableFields: ["start_date", "end_date", "discount_value", "createdAt"],
      searchFields: [],
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
    };
  }

  // Não sobrescrevem findById/paginate herdados (o retorno com escopo
  // achatado não é estruturalmente compatível com o tipo base Model) — são
  // métodos à parte, chamados pelo controller (index/show sobrescritos lá)
  // pra sempre trazer o escopo (marca/aro/medida/loja) junto, já achatado
  // em *_ids: o mesmo formato que create/update esperam, pra edição no
  // front ser um fetch + reenvio direto do mesmo objeto, sem remapear nada.
  async findDetailedById(id: string): Promise<SupplierDiscountRuleDetail | null> {
    const rule = await this.repository.findById(id, {
      include: SCOPE_INCLUDE,
    });
    return rule ? toDetail(rule) : null;
  }

  async paginateDetailed(
    params: QueryParams,
  ): Promise<PaginatedResult<SupplierDiscountRuleDetail>> {
    const result = await this.repository.findPaginated(
      params,
      this.queryConfig,
      { include: SCOPE_INCLUDE },
    );
    return { ...result, data: result.data.map(toDetail) };
  }

  async create(data: SupplierDiscountRuleInput): Promise<SupplierDiscountRule> {
    const sequelize = SupplierDiscountRule.sequelize!;
    const transaction = await sequelize.transaction();

    try {
      const rule = await this.createOrUpdate(null, data, transaction);
      await transaction.commit();
      return rule;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  async update(
    id: string,
    data: SupplierDiscountRuleInput,
  ): Promise<SupplierDiscountRule> {
    const sequelize = SupplierDiscountRule.sequelize!;
    const transaction = await sequelize.transaction();

    try {
      const rule = await this.createOrUpdate(id, data, transaction);
      await transaction.commit();
      return rule;
    } catch (err) {
      await transaction.rollback();
      throw err;
    }
  }

  private async createOrUpdate(
    id: string | null,
    data: SupplierDiscountRuleInput,
    transaction: Transaction,
  ): Promise<SupplierDiscountRule> {
    const brandIds = data.brand_ids ?? [];
    const rimIds = data.rim_ids ?? [];
    const measureIds = data.measure_ids ?? [];
    const unitBusinessIds = data.unit_business_ids ?? [];

    if (!unitBusinessIds.length) {
      throw new Error(
        "Erro: Ids das unidades de negócio não pode ser vazio — loja não é um eixo curinga.",
      );
    }
    if (
      data.quantity_step == null ||
      !data.discount_type ||
      data.discount_value == null ||
      !data.start_date ||
      !data.end_date
    ) {
      throw new Error(
        "Erro: Quantidade de Pneus, Tipo do Desconto, Valor do Desconto, Data de Início e Data Final são obrigatórios.",
      );
    }

    const discountType = data.discount_type;
    const startDate = new Date(data.start_date);
    const endDate = new Date(data.end_date);

    const overlapping = await this.repository.findOverlapping(
      {
        discountType,
        startDate,
        endDate,
        brandIds,
        rimIds,
        measureIds,
        unitBusinessIds,
      },
      id ?? undefined,
      { transaction },
    );

    if (overlapping) {
      throw new Error(
        "Já existe uma regra ativa com escopo e período sobrepostos envolvendo desconto PERCENTUAL nesse conjunto de marca/aro/medida/loja.",
      );
    }

    const ruleFields = {
      quantity_step: data.quantity_step,
      discount_type: discountType,
      discount_value: data.discount_value,
      start_date: startDate,
      end_date: endDate,
      active: data.active ?? true,
    };

    const rule = id
      ? await this.repository.update(id, ruleFields, { transaction })
      : await this.repository.create(ruleFields, { transaction });

    if (!rule) {
      throw new Error(
        `supplier_discount_rules: regra id=${id} não encontrada`,
      );
    }

    await supplierDiscountRuleBrandService.syncForRule(rule.id, brandIds, {
      transaction,
    });
    await supplierDiscountRuleRimService.syncForRule(rule.id, rimIds, {
      transaction,
    });
    await supplierDiscountRuleMeasureService.syncForRule(
      rule.id,
      measureIds,
      { transaction },
    );
    await supplierDiscountUnitBusinessService.syncForRule(
      rule.id,
      unitBusinessIds,
      { transaction },
    );

    return rule;
  }

  // Motor de matching: agrupa os itens por (pedido + marca + aro + medida +
  // loja), soma a quantidade real de cada grupo, e decompõe usando as
  // regras candidatas — REAL em blocos (maior quantity_step primeiro, pra
  // formar níveis por quantidade), PERCENTUAL como limiar único. REAL e
  // PERCENTUAL nunca coexistem no mesmo grupo (bloqueado na criação), mas o
  // código não assume isso.
  async resolveForItems(
    items: SupplierDiscountResolveItemInput[],
  ): Promise<Map<string, SupplierDiscountResolveResult>> {
    const result = new Map<string, SupplierDiscountResolveResult>();
    if (!items.length) return result;

    const candidates = await this.repository.matchBatch(items);
    const candidatesByItem = groupBy(candidates, (c) => c.order_item_id);
    const pools = groupBy(items, (i) =>
      [i.order_id, i.brand_id, i.rim_id, i.measure_id, i.unit_business_id].join(
        "|",
      ),
    );

    for (const poolItems of Object.values(pools)) {
      const poolRealQuantity = poolItems.reduce(
        (sum, i) => sum + i.real_quantity,
        0,
      );
      const poolGrossTotal = poolItems.reduce(
        (sum, i) => sum + i.gross_total,
        0,
      );

      const seenRuleIds = new Set<string>();
      const rules: SupplierDiscountCandidateRow[] = [];
      for (const item of poolItems) {
        for (const candidate of candidatesByItem[item.order_item_id] ?? []) {
          if (!seenRuleIds.has(candidate.rule_id)) {
            seenRuleIds.add(candidate.rule_id);
            rules.push(candidate);
          }
        }
      }

      const percentualRules = rules.filter(
        (r) => r.discount_type === "PERCENTUAL",
      );
      const realRules = rules.filter((r) => r.discount_type === "REAL");

      let totalDiscount = 0;
      let primaryRuleId: string | null = null;

      if (percentualRules.length > 0) {
        let best: { ruleId: string; value: number } | null = null;
        for (const rule of percentualRules) {
          if (poolRealQuantity < rule.quantity_step) continue;
          const value = round2(
            poolGrossTotal * (Number(rule.discount_value) / 100),
          );
          if (!best || value > best.value) {
            best = { ruleId: rule.rule_id, value };
          }
        }
        if (best) {
          totalDiscount = best.value;
          primaryRuleId = best.ruleId;
        }
      } else if (realRules.length > 0) {
        const sorted = [...realRules].sort(
          (a, b) => b.quantity_step - a.quantity_step,
        );
        let remaining = poolRealQuantity;
        let bestContribution = 0;
        for (const rule of sorted) {
          if (rule.quantity_step <= 0) continue;
          const blocks = Math.floor(remaining / rule.quantity_step);
          if (blocks <= 0) continue;
          const contribution = blocks * Number(rule.discount_value);
          totalDiscount += contribution;
          remaining -= blocks * rule.quantity_step;
          if (contribution > bestContribution) {
            bestContribution = contribution;
            primaryRuleId = rule.rule_id;
          }
        }
      }

      if (totalDiscount <= 0) {
        // Sem match: grava 0/null explicitamente (não pula) — se um
        // reprocessamento perder um desconto que existia antes (regra
        // desativada, quantidade mudou), precisa zerar o que ficou
        // gravado no snapshot, não deixar o valor antigo parado lá.
        for (const item of poolItems) {
          result.set(item.order_item_id, { discountValue: 0, ruleId: null });
        }
        continue;
      }

      // Rateio proporcional simples — o total do grupo é o que importa pro
      // lucro, a divisão por item é só pra ter um número plausível por linha.
      let allocated = 0;
      poolItems.forEach((item, idx) => {
        const isLast = idx === poolItems.length - 1;
        const share = isLast
          ? round2(totalDiscount - allocated)
          : round2(totalDiscount * (item.real_quantity / poolRealQuantity));
        allocated += share;
        result.set(item.order_item_id, {
          discountValue: share,
          ruleId: primaryRuleId,
        });
      });
    }

    return result;
  }
}

export default new SupplierDiscountRuleService();
