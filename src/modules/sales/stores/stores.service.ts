import BaseService from "../../../shared/utils/base-models/base-service";
import Store from "./stores.model";
import storeRepository, { StoreRepository } from "./stores.repository";
import { storeCreationAttributes } from "./stores.types";

export class StoreService extends BaseService<Store, StoreRepository> {
    constructor() {
        super(storeRepository)

         this.queryConfig = {
      stringFields: ["name"],
      defaults: {
        perPage: 20,
        sortBy: ["name"],
        sortDir: ["ASC", "ASC"],
      },
      // Campos para busca textual (LIKE)
      searchFields: ["name"],
    }
    }

    async findOrCreateByName(name: string, idStoreSystem: string): Promise<Store> {
        return this.repository.findOrCreateByName(name, idStoreSystem);
    }
}

export default new StoreService();