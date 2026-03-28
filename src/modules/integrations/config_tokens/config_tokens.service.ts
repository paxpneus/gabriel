import BaseService from "../../../shared/utils/base-models/base-service";
import ConfigToken from "./config_tokens.model";
import configTokenRepository, { ConfigTokenRepository } from "./config_tokens.repository";
export class ConfigTokenService extends BaseService<ConfigToken, ConfigTokenRepository> {
    constructor() { super(configTokenRepository) }
}
export default new ConfigTokenService();