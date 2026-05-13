import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import CarrierImportLayout from "./carrier-import-layouts.model";

export class CarrierImportLayoutRepository extends BaseRepository<CarrierImportLayout> {
  constructor() {
    super(CarrierImportLayout);
  }
}

export default new CarrierImportLayoutRepository();
