import BaseController from "../../../shared/utils/base-models/base-controller";
import Store from "./stores.model";
import storeService, { StoreService } from "./stores.service";
import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";

class StoreController extends BaseController<Store, StoreService> {
  constructor() {
    super(storeService);
  }

  protected middlewaresFor() {
    return {
      // Leitura só com login (lista de canais usada em várias telas); escrita exige Pedidos ("Canais de venda" herda do pai).
      index: [authenticate],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate],
      destroy: [authenticate, userPermissions],
      // Ações do CRUD genérico sem chave aqui ficavam sem middleware nenhum.
      bulkCreate: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }
}

export default new StoreController();
