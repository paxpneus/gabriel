import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Store from "./stores.model";

export class StoreRepository extends BaseRepository<Store> {
    constructor() {
        super(Store);
    }

    // findOrCreate relies on a DB-level unique index on name to be race-safe
    // under concurrent webhook processing — see migration that adds it.
    async findOrCreateByName(name: string, idStoreSystem: string): Promise<Store> {
        const [store] = await Store.findOrCreate({
            where: { name },
            defaults: { name, id_store_system: idStoreSystem },
        });
        return store;
    }
}

export default new StoreRepository();