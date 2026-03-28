import BaseController from "../../../shared/utils/base-models/base-controller";
import Integration from "./integrations.model";
import integrationService, { IntegrationService } from "./integrations.service";
class IntegrationController extends BaseController<Integration, IntegrationService> {
    constructor() { super(integrationService) }
}
export default new IntegrationController();