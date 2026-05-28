import { generateOperationCode } from './../../../../shared/utils/normalizers/operation-nomenclature';
import sequelize from "../../../../config/sequelize";
import { QueryParams, PaginatedResult } from "../../../../shared/query/query.types";
import BaseService from "../../../../shared/utils/base-models/base-service";
import UnitBusiness from "../../unit-business/unit-business.model";
import OperationsItens from "../operations-itens/operations-itens.model";
import Operations from "./operations.model";
import operationsRepository, { OperationsRepository } from "./operations.repository";
import { CreateOperationItemDTO } from "./operations.types";
import { CreateOptions, FindOptions, Op } from "sequelize";
import { Product } from '../../../inventory';
import Invoice from '../../entrance/invoice/invoice.model';

// ─── service ──────────────────────────────────────────────────────────────────

export class OperationsService extends BaseService<Operations, OperationsRepository> {
  constructor() {
    super(operationsRepository)

    this.queryConfig = {
      defaults: { perPage: 20, sortBy: 'createdAt', sortDir: 'DESC' },
      searchFields: ['description', 'transporter_name', 'code'],
      filterableFields: ['status', 'invoice_id', 'from_unit', 'to_unit'],
      sortableFields: ['date', 'from_unit', 'to_unit', 'due_at', 'expected_at', 'status', 'createdAt', 'updatedAt', 'transporter_name'],
      customFields: {
    unit: (value) => ({
      [Op.or]: [
        { from_unit: value },
        { to_unit: value },
      ],
    }),
  },
    }
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, 'where' | 'limit' | 'offset' | 'order'>,
  ): Promise<PaginatedResult<Operations>> {
    return super.paginate(params, {
      ...extraOptions,
      include: [
        { model: UnitBusiness, as: 'fromUnit' },
        { model: UnitBusiness, as: 'toUnit' },
      ],
    })
  }

  async findById(id: string, options?: FindOptions): Promise<Operations | null> {
      return this.repository.findById(id, {
        include: [
          { model: UnitBusiness, as: 'fromUnit' },
        { model: UnitBusiness, as: 'toUnit' },
        {model: OperationsItens, as: 'items', include: [
          {
            model: Product,
            as: 'product'
          }
        ]},
        {model: Invoice, as: 'invoice'}
        ]
      });
  }

  

  async create(
    data: Partial<Operations['_creationAttributes']> & { items?: CreateOperationItemDTO[] },
    options?: CreateOptions,
  ): Promise<Operations> {
    const run = async (transaction: any) => {
      const { items = [], ...operationPayload } = data

      // ── Busca números das filiais para compor o code ───────────────────────
      const [fromUnit, toUnit] = await Promise.all([
        operationPayload.from_unit
          ? UnitBusiness.findByPk(operationPayload.from_unit, { transaction })
          : null,
        operationPayload.to_unit
          ? UnitBusiness.findByPk(operationPayload.to_unit, { transaction })
          : null,
      ])

      const fromNumber = (fromUnit as any)?.number ?? operationPayload.from_unit ?? 'X'
      const toNumber   = (toUnit   as any)?.number ?? operationPayload.to_unit   ?? 'X'

      const code = await generateOperationCode(
        String(fromNumber),
        String(toNumber),
        operationPayload.from_unit!,
        transaction,
      )

      const totalQuantity =
        operationPayload.total_quantity ??
        items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)

      const operation = await this.repository.create(
        {
          ...operationPayload,
          code,
          date: new Date(),
          total_quantity: totalQuantity,
        },
        { transaction },
      )

      if (items.length) {
        await OperationsItens.bulkCreate(
          items.map((item) => ({ ...item, operation_id: operation.id })),
          { transaction },
        )
      }

      return (await this.repository.findByIdWithRelations(operation.id)) ?? operation
    }

    if (options?.transaction) {
      return run(options.transaction)
    }

    return sequelize.transaction(run)
  }

  findByIdFull(id: string) {
    return this.repository.findByIdWithRelations(id)
  }
}

export default new OperationsService()