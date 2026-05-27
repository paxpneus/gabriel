import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import OperationsItens from "./operations-itens.model";

export class OperationsItensRepository extends BaseRepository<OperationsItens> {
  constructor() {
    super(OperationsItens);
  }
}

export default new OperationsItensRepository();
