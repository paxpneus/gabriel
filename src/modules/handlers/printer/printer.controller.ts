import { Request, Response } from 'express'
import BaseController from '../../../shared/utils/base-models/base-controller'
import { authenticate } from '../../../middlewares/auth-token'
import PrinterConfig from './printer.models'
import PrinterConfigService from './printer.service'

export class PrinterConfigController extends BaseController<PrinterConfig, typeof PrinterConfigService> {
  constructor() {
    super(PrinterConfigService)
    this.registerCustomRoutes()
    
  }

  // Sem middlewaresFor o CRUD genérico de impressora ficava aberto sem login.
  protected middlewaresFor() {
    return {
      index: [authenticate],
      show: [authenticate],
      create: [authenticate],
      bulkCreate: [authenticate],
      update: [authenticate],
      bulkUpdate: [authenticate],
      destroy: [authenticate],
      bulkDestroy: [authenticate],
    }
  }

  

  private registerCustomRoutes() {
    this.router.get('/active', (req, res) => this.getActive(req, res))
  }

  getActive = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { unitBusinessId } = req.query
      if (!unitBusinessId) return res.status(400).json({ error: 'unitBusinessId obrigatório' })

      const config = await PrinterConfigService.getActiveByUnitBusiness(unitBusinessId as string)
      if (!config) return res.status(404).json({ error: 'Nenhuma impressora configurada' })

      return res.json(config)
    } catch (err: any) {
      return res.status(500).json({ error: err.message })
    }
  }
}

export default new PrinterConfigController()