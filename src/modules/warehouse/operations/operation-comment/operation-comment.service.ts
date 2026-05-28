import { FindOptions } from "sequelize";
import { QueryParams, PaginatedResult } from "../../../../shared/query/query.types";
import BaseService from "../../../../shared/utils/base-models/base-service";
import OperationComment from "./operation-comment.model";
import operationCommentRepository, {
  OperationCommentRepository,
} from "./operation-comment.repository";
import User from "../../users/users/user.model";
import Operations from "../operation/operations.model";
import UnitBusiness from "../../unit-business/unit-business.model";
import type { NewMessageEmailPayload } from "../../../../shared/providers/mail-provider/operations/templates/operation.templates";
import nodemailerOperationService from "../../../../shared/providers/mail-provider/operations/nodemailer-operation.service";

export class OperationCommentService extends BaseService<
  OperationComment,
  OperationCommentRepository
> {
  constructor() {
    super(operationCommentRepository);

    this.queryConfig = {
      defaults: { perPage: 20, sortBy: "createdAt", sortDir: "DESC" },
      searchFields: ["comment"],
      filterableFields: ["user_id", "unit_business_id", "operation_id", "point_to"],
      sortableFields: ["date", "createdAt", "updatedAt"],
    };
  }

  async create(
    data: Partial<OperationComment["_creationAttributes"]>,
    options?: any,
  ): Promise<OperationComment> {
    const comment = await super.create(data, options);

    // fire-and-forget — não bloqueia o retorno
    this.sendCommentNotification(comment).catch(() => {});

    return comment;
  }

  private async sendCommentNotification(comment: OperationComment): Promise<void> {
    const [user, operation] = await Promise.all([
      User.findByPk((comment as any).user_id, {
        attributes: ['id', 'name', 'unit_business_id'],
      }),
      Operations.findByPk((comment as any).operation_id, {
        include: [
          { model: UnitBusiness, as: 'fromUnit' },
          { model: UnitBusiness, as: 'toUnit'   },
        ],
      }),
    ]);

    if (!user || !operation) return;

    const senderUnitId: string = (user as any).unit_business_id;
    const fromUnit = (operation as any).fromUnit;
    const toUnit   = (operation as any).toUnit;

    // Quem enviou → destina à outra ponta
    const isFromSide = senderUnitId === (operation as any).from_unit;
    const targetUnit: typeof fromUnit = isFromSide ? toUnit : fromUnit;

    if (!targetUnit) return;

    const emails: string[] = targetUnit.emails ?? [];
    if (!emails.length) return;

    const payload: NewMessageEmailPayload = {
      senderName:      (user as any).name,
      senderUnitName:  isFromSide ? fromUnit?.name : toUnit?.name,
      operationCode:   (operation as any).code ?? (comment as any).operation_id,
      comment:         (comment as any).comment,
      date:            (comment as any).createdAt ?? new Date(),
    };

    await Promise.allSettled(
      emails.map(to => nodemailerOperationService.notifyNewMessage(to, payload))
    );
  }

  async paginate(
    params: QueryParams,
    extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">,
  ): Promise<PaginatedResult<OperationComment>> {
    return super.paginate(params, {
      ...extraOptions,
      include: [{ model: User, as: 'user', attributes: ['name', 'id'] }],
    });
  }
}

export default new OperationCommentService();