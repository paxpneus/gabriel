import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Step from "./steps.model";

export class StepRepository extends BaseRepository<Step> {
    constructor() {
        super(Step);
    }
}
export default new StepRepository();