import BaseService from "../../../shared/utils/base-models/base-service";
import Store from "./stores.model";
import storeRepository, { StoreRepository } from "./stores.repository";

export class StoreService extends BaseService<Store, StoreRepository> {
    constructor() {
        super(storeRepository)
    }

}

export default new StoreService();