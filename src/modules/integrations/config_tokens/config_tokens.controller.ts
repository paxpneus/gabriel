import { authenticate } from "../../../middlewares/auth-token";
import { userPermissions } from "../../../middlewares/user-permissions";
import BaseController, { StoreNumberField } from "../../../shared/utils/base-models/base-controller";
import ConfigToken from "./config_tokens.model";
import configTokenService, { ConfigTokenService } from "./config_tokens.service";
class ConfigTokenController extends BaseController<ConfigToken, ConfigTokenService> {
    constructor() { super(configTokenService) }

      // ?store_number= de application filtra o index por integrations_id.
      protected storeNumberField(): StoreNumberField {
        return "integrations_id";
      }

      protected middlewaresFor() {
          return {
            index: [authenticate, userPermissions],
            create: [authenticate, userPermissions],
            update: [
              authenticate,
              userPermissions
            ],
            show: [authenticate, userPermissions],
            destroy: [authenticate, userPermissions],
            // CRUD bulk do BaseController: sem chave aqui a rota ficava sem nenhum middleware.
            bulkCreate: [authenticate, userPermissions],
            bulkUpdate: [authenticate, userPermissions],
            bulkDestroy: [authenticate, userPermissions],
          };
        }
}
export default new ConfigTokenController();
