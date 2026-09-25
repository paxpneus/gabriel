import BaseRepository from "../../../shared/utils/base-models/base-repository";
import TempFile from "./temp-file.model";

export class TempFileRepository extends BaseRepository<TempFile> {
  constructor() {
    super(TempFile);
  }
}

export default new TempFileRepository();
