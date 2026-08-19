import BaseService from "../../../shared/utils/base-models/base-service";
import Area from "./areas.model";
import areaRepository, { AreaRepository } from "./areas.repository";
export class AreaService extends BaseService<Area, AreaRepository> { constructor() { super(areaRepository); this.queryConfig = { filterableFields: ["is_active"], sortableFields: ["name", "createdAt"], searchFields: ["name"], defaults: { perPage: 20, sortBy: "name", sortDir: "ASC" } }; } }
export default new AreaService();
