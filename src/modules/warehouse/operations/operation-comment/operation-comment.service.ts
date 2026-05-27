import BaseService from "../../../../shared/utils/base-models/base-service";
import OperationComment from "./operation-comment.model";
import operationCommentRepository, {
  OperationCommentRepository,
} from "./operation-comment.repository";

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
      filterableFields: ["userId", "unitBusinessId", "operationId", "pointTo"],
      sortableFields: ["date", "createdAt", "updatedAt"],
    };
  }
}

export default new OperationCommentService();
