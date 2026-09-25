import BaseService from "../../../shared/utils/base-models/base-service";
import TempFile from "./temp-file.model";
import tempFileRepository, { TempFileRepository } from "./temp-file.repository";

export class TempFileService extends BaseService<TempFile, TempFileRepository> {
  constructor() {
    super(tempFileRepository);
  }
}

export default new TempFileService();
