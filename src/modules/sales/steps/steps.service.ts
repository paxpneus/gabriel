import BaseService from "../../../shared/utils/base-models/base-service";
import Step from "./steps.model";
import stepRepository, { StepRepository } from "./steps.repository";

export class StepService extends BaseService<Step, StepRepository> {
    constructor() {
        super(stepRepository);
    }
}
export default new StepService();