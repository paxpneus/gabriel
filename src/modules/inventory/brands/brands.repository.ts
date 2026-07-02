import BaseRepository from "../../../shared/utils/base-models/base-repository";
import Brand from "./brands.model";

export class BrandRepository extends BaseRepository<Brand> {
  constructor() {
    super(Brand);
  }
}

export default new BrandRepository();
