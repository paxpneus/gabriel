import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import OperationComment from "./operation-comment.model";

export class OperationCommentRepository extends BaseRepository<OperationComment> {
  constructor() {
    super(OperationComment);
  }
}

export default new OperationCommentRepository();
