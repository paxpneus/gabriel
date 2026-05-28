import { FindOptions } from "sequelize";
import { QueryParams, PaginatedResult } from "../../../../shared/query/query.types";
import BaseService from "../../../../shared/utils/base-models/base-service";
import OperationComment from "./operation-comment.model";
import operationCommentRepository, {
  OperationCommentRepository,
} from "./operation-comment.repository";
import User from "../../users/users/user.model";

export class OperationCommentService extends BaseService<
  OperationComment,
  OperationCommentRepository
> {
  constructor() {
    super(operationCommentRepository);

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "createdAt",
        sortDir: "DESC",
      },
      searchFields: ["comment"],
      filterableFields: ["user_id", "unit_business_id", "operation_id", "point_to"],
      sortableFields: ["date", "createdAt", "updatedAt"],
    };
  }

  async paginate(params: QueryParams, extraOptions?: Omit<FindOptions, "where" | "limit" | "offset" | "order">): Promise<PaginatedResult<OperationComment>> {
      return super.paginate(params, {
        ...extraOptions,
        include: [
          {model: User,
            as: 'user',
            attributes: ['name', 'id']
          }
        ]
      })
  }
}


export default new OperationCommentService();
