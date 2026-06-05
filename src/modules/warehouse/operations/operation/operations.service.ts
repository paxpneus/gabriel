import { generateOperationCode } from "./../../../../shared/utils/normalizers/operation-nomenclature";
import sequelize from "../../../../config/sequelize";
import {
  QueryParams,
  PaginatedResult,
} from "../../../../shared/query/query.types";
import BaseService from "../../../../shared/utils/base-models/base-service";
import UnitBusiness from "../../unit-business/unit-business.model";
import OperationsItens from "../operations-itens/operations-itens.model";
import Operations from "./operations.model";
import operationsRepository, {
  OperationsRepository,
} from "./operations.repository";
import {
  CreateOperationItemDTO,
  OperationsCreationAttributes,
} from "./operations.types";
import {
  CreateOptions,
  DestroyOptions,
  FindOptions,
  Op,
  UpdateOptions,
} from "sequelize";
import { Product, ProductConfig } from "../../../inventory";
import Invoice from "../../entrance/invoice/invoice.model";
import User from "../../users/users/user.model";
import type {
  InvoiceLinkedEmailPayload,
  OperationRequestEmailPayload,
} from "./../../../../shared/providers/mail-provider/operations/templates/operation.templates";
import nodemailerOperationService from "../../../../shared/providers/mail-provider/operations/nodemailer-operation.service";
import OperationComment from "../operation-comment/operation-comment.model";
// ─── service ──────────────────────────────────────────────────────────────────

export class OperationsService extends BaseService<
  Operations,
  OperationsRepository
> {
  constructor() {
    super(operationsRepository);

    this.queryConfig = {
      defaults: { perPage: 20, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: ["description", "transporter_name", "code"],
      filterableFields: [
        "status",
        "priority_level",
        "invoice_id",
        "from_unit",
        "to_unit",
        "request_user",
        "receiver_user",
      ],
      sortableFields: [
        "date",
        "from_unit",
        "to_unit",
        "due_at",
        "expected_at",
        "status",
        "priority_level",
        "createdAt",
        "updatedAt",
        "transporter_name",
      ],
      customFields: {
        unit: (value) => ({
          [Op.or]: [{ from_unit: value }, { to_unit: value }],
        }),
      },
    };
  }

  // ─── update ───────────────────────────────────────────────────────────────────

  async update(
    id: string,
    data: Partial<OperationsCreationAttributes>,
    options?: Partial<UpdateOptions>,
  ): Promise<Operations | null> {
    return sequelize.transaction(async (t) => {
      const existing = await this.findById(id, { transaction: t });

      if (!existing) throw new Error("Operação não encontrada!");
      if (existing.status === "FINISHED")
        throw new Error("Operações finalizadas não podem ser alteradas");

      const isLinkingInvoice =
        existing.status === "OPEN" && (data.invoice_id || data.invoice_number);

      if (isLinkingInvoice) {
        await existing.update(
          {
            sender_confirmation: true,
            status: "PENDING",
            receiver_user: data.receiver_user,
            ...data,
          },
          { transaction: t },
        );

        // ── Busca e-mails da unidade de destino (to_unit) ─────────────────────
        const toUnit = existing.to_unit
          ? await UnitBusiness.findByPk(existing.to_unit, { transaction: t })
          : null;

        const emails: string[] = (toUnit as any)?.emails ?? [];

        if (emails.length) {
          const payload: InvoiceLinkedEmailPayload = {
            code: existing.code ?? id,
            invoiceNumber: String(data.invoice_number ?? data.invoice_id ?? ""),
          };

          // fire-and-forget — não bloqueia a transação
          Promise.allSettled(
            emails.map((to) =>
              nodemailerOperationService.notifyInvoiceLinked(to, payload),
            ),
          ).catch(() => {});
        }
      }

      return this.repository.update(id, data, { transaction: t, ...options });
    });
  }

  // ─── create ───────────────────────────────────────────────────────────────────

  async create(
    data: Partial<Operations["_creationAttributes"]> & {
      items?: CreateOperationItemDTO[];
    },
    options?: CreateOptions,
  ): Promise<Operations> {
    const run = async (transaction: any) => {
      const { items = [], ...operationPayload } = data;

      const [fromUnit, toUnit] = await Promise.all([
        operationPayload.from_unit
          ? UnitBusiness.findByPk(operationPayload.from_unit, { transaction })
          : null,
        operationPayload.to_unit
          ? UnitBusiness.findByPk(operationPayload.to_unit, { transaction })
          : null,
      ]);

      const fromNumber =
        (fromUnit as any)?.number ?? operationPayload.from_unit ?? "X";
      const toNumber =
        (toUnit as any)?.number ?? operationPayload.to_unit ?? "X";

      const code = await generateOperationCode(
        String(fromNumber),
        String(toNumber),
        transaction,
      );

      const totalQuantity =
        operationPayload.total_quantity ??
        items.reduce((sum, item) => sum + Number(item.quantity ?? 0), 0);

      const operation = await this.repository.create(
        {
          ...operationPayload,
          code,
          date: new Date(),
          total_quantity: totalQuantity,
        },
        { transaction },
      );

      if (items.length) {
        await OperationsItens.bulkCreate(
          items.map((item) => ({
            operation_id: operation.id,
            product_id: item.product_id,
            quantity: item.quantity,
            code: item.code,
            description: item.description,
          })),
          { transaction },
        );
      }

      // ── Notifica e-mails da unidade de origem (from_unit) ─────────────────
      const fullOperation = await this.repository.findByIdWithRelations(
        operation.id,
        undefined,
        { transaction },
      );

      const fromEmails: string[] = (fromUnit as any)?.emails ?? [];

      if (fromEmails.length) {
        const payload: OperationRequestEmailPayload = {
          fromUnitName: (fromUnit as any)?.name ?? String(fromNumber),
          toUnitName: (toUnit as any)?.name ?? String(toNumber),
          code,
          items: (fullOperation?.items ?? items).map((item: any) => ({
            nameOrDescription:
              item.product?.name ??
              item.description ??
              item.code ??
              "Item sem descrição",
            quantity: Number(item.quantity),
            code: item.product?.sku ?? undefined,
          })),
        };

        Promise.allSettled(
          fromEmails.map((to) =>
            nodemailerOperationService.notifyNewOperationRequest(to, payload),
          ),
        ).catch(() => {});
      }

      return fullOperation ?? operation;
    };

    if (options?.transaction) return run(options.transaction);
    return sequelize.transaction(run);
  }

  async markAsReceived(id: string, userId: string): Promise<void> {
    const existing = await this.findById(id);

    if (!existing) {
      throw new Error("Operação não encontrada!");
    }

    if (existing.status === "PENDING") {
      existing.update({
        receiver_confirmation: true,
        status: "FINISHED",
      });
    } else {
      throw new Error("Somente Operações pendentes podem ser confirmadas!");
    }
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<Operations>> {
    const unitBusinessId = params.filters?.unit as string | undefined;

    const filters = { ...params.filters };

    return super.paginate(params, {
      ...extraOptions,
      include: [
        { model: UnitBusiness, as: "fromUnit", attributes: ["name", "id"] },
        { model: UnitBusiness, as: "toUnit", attributes: ["name", "id"] },
        { model: User, as: "requestUser", attributes: ["id", "name", "email"] },
        {
          model: User,
          as: "receiverUser",
          attributes: ["id", "name", "email"],
        },
        {
          model: OperationsItens,
          as: "items",
          include: [
            {
              model: Product,
              as: "product",
              attributes: ["name", "sku", "id"],
              include: [
                {
                  model: ProductConfig,
                  as: "productConfigs",
                  required: false,
                  where: unitBusinessId
                    ? { unit_business_id: unitBusinessId }
                    : undefined,
                },
              ],
            },
          ],
        },
        {
          model: OperationComment,
          as: "comments",
          limit: 2,
        },
        {
          model: Invoice,
          as: "invoice",
          attributes: ["id", "number_system"],
        },
      ],
    });
  }

  findByIdFull(id: string, unitBusinessId?: string) {
    return this.repository.findByIdWithRelations(id, unitBusinessId);
  }

  async findById(
    id: string,
    options?: FindOptions,
    unitBusinessId?: string,
  ): Promise<Operations | null> {
    return this.repository.findById(id, {
      ...options,
      include: [
        { model: UnitBusiness, as: "fromUnit" },
        { model: UnitBusiness, as: "toUnit" },
        { model: User, as: "requestUser", attributes: ["id", "name", "email"] },
        {
          model: User,
          as: "receiverUser",
          attributes: ["id", "name", "email"],
        },
        {
          model: OperationsItens,
          as: "items",
          include: [
            {
              model: Product,
              as: "product",
              include: [
                {
                  model: ProductConfig,
                  as: "productConfigs",
                  required: false,
                  where: unitBusinessId
                    ? { unit_business_id: unitBusinessId }
                    : undefined,
                },
              ],
            },
          ],
        },
        { model: Invoice, as: "invoice" },
      ],
    });
  }

  async bulkDelete(options: DestroyOptions): Promise<number> {
    if (!options || !options.where) {
      throw new Error("Opções de busca não informadas.");
    }

    const possuiCancelados = await Operations.count({
      where: {
        ...options.where,
        status: ["FINISHED", "PENDING"],
      },
    });

    if (possuiCancelados > 0) {
      throw new Error(
        "Não é permitido excluir registros que possuem o status em pendente ou finalizado.",
      );
    }

    return await this.repository.bulkDelete(options);
  }
}

export default new OperationsService();
