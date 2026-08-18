import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Area from "./areas.model";
export class AreaRepository extends BaseRepository<Area> { constructor() { super(Area); } }
export default new AreaRepository();
