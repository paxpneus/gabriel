import BaseController from "../../../shared/utils/base-models/base-controller";
import Store from "./stores.model";
import storeService, { StoreService } from "./stores.service";

class StoreController extends BaseController<Store, StoreService> {
    constructor() {
        super(storeService)
    }
}

export default new StoreController();