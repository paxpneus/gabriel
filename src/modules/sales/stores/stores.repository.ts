import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Store from "./stores.model";

export class StoreRepository extends BaseRepository<Store> {
    constructor() {
        super(Store);
    }
}

export default new StoreRepository();