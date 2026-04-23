import BaseRepository from '../../../shared/utils/base-models/base-repository'
import PrinterConfig from './printer.models'

export class PrinterConfigRepository extends BaseRepository<PrinterConfig> {
  constructor() {
    super(PrinterConfig)
  }
}

export default new PrinterConfigRepository()