import BaseService from '../../../shared/utils/base-models/base-service'
import PrinterConfig from './printer.models'
import printerConfigRepository, { PrinterConfigRepository } from './printer.repository'

export class PrinterConfigService extends BaseService<PrinterConfig, PrinterConfigRepository> {
  constructor() {
    super(printerConfigRepository)
  }

  async getActiveByUnitBusiness(unitBusinessId: string): Promise<PrinterConfig | null> {
    return PrinterConfig.findOne({
      where: { unit_business_id: unitBusinessId, is_active: true },
    })
  }
}

export default new PrinterConfigService()