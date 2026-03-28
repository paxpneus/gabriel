import BaseService from "../../../shared/utils/base-models/base-service";
import Integration from "./integrations.model";
import integrationRepository, { IntegrationRepository } from "./integrations.repository";
export class IntegrationService extends BaseService<Integration, IntegrationRepository> {
    constructor() { super(integrationRepository) }
}
export default new IntegrationService();