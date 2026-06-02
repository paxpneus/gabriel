import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Application from "./applications.model";

export class ApplicationRepository extends BaseRepository<Application> {
  constructor() {
    super(Application);
  }
}

export default new ApplicationRepository();

