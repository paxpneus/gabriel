import BaseController from "../../../shared/utils/base-models/base-controller";
import Step from "./steps.model";
import stepService, { StepService } from "./steps.service";

class StepController extends BaseController<Step, StepService> {
    constructor() {
        super(stepService);
    }
}
export default new StepController();