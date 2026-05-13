import BaseRepository from "../../../../shared/utils/base-models/base-repository";
import CarrierLabelRange from "./carrier-label-ranges.model";

export class CarrierLabelRangeRepository extends BaseRepository<CarrierLabelRange> {
  constructor() {
    super(CarrierLabelRange);
  }
}

export default new CarrierLabelRangeRepository();
