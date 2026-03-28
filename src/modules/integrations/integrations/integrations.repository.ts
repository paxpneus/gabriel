import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Integration from "./integrations.model";
export class IntegrationRepository extends BaseRepository<Integration> {
    constructor() { super(Integration) }
}
export default new IntegrationRepository();