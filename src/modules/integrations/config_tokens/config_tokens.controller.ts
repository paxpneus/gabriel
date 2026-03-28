import BaseController from "../../../shared/utils/base-models/base-controller";
import ConfigToken from "./config_tokens.model";
import configTokenService, { ConfigTokenService } from "./config_tokens.service";
class ConfigTokenController extends BaseController<ConfigToken, ConfigTokenService> {
    constructor() { super(configTokenService) }
}
export default new ConfigTokenController();

