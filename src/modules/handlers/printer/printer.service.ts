import BaseService from '../../../shared/utils/base-models/base-service'
import PrinterConfig from './printer.models'
import printerConfigRepository, { PrinterConfigRepository } from './printer.repository'

export class PrinterConfigService extends BaseService<PrinterConfig, PrinterConfigRepository> {
  constructor() {
    super(printerConfigRepository)

    this.queryConfig = {
      defaults: {
        perPage: 20,
        sortBy: "emitted_at",
        sortDir: "DESC",
      },
    
      searchFields: ["printer_name", "server_ip"],
   
      filterableFields: [
        "unit_business_id",
        "is_active"
      ],
      sortableFields: [
         "printer_name",
        "is_active",
        "createdAt",
       
      ],
    };
  }

  async getActiveByUnitBusiness(unitBusinessId: string): Promise<PrinterConfig | null> {
    return PrinterConfig.findOne({
      where: { unit_business_id: unitBusinessId, is_active: true },
    })
  }
}

export default new PrinterConfigService()