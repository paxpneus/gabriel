import { authenticate } from "../../../middlewares/auth-token";
import BaseController from "../../../shared/utils/base-models/base-controller";
import ConfigToken from "./config_tokens.model";
import configTokenService, { ConfigTokenService } from "./config_tokens.service";
class ConfigTokenController extends BaseController<ConfigToken, ConfigTokenService> {
    constructor() { super(configTokenService) }

      protected middlewaresFor() {
          return {
            index: [authenticate],
            create: [authenticate],
            update: [
              authenticate
            ],
            show: [authenticate],
            destroy: [authenticate],
          };
        }
}
export default new ConfigTokenController();

