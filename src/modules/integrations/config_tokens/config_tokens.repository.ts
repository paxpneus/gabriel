import BaseRepository from "../../../shared/utils/base-models/base-repository";
import ConfigToken from "./config_tokens.model";
export class ConfigTokenRepository extends BaseRepository<ConfigToken> {
    constructor() { super(ConfigToken) }
}
export default new ConfigTokenRepository();