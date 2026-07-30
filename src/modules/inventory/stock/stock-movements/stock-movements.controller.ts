import { Request, Response, NextFunction } from 'express';
import BaseController from '../../../../shared/utils/base-models/base-controller';
import StockMovement from './stock-movements.model';
import StockMovementService from './stock-movements.service';

export class StockMovementController extends BaseController<
  StockMovement,
  typeof StockMovementService
> {
  constructor() {
    super(StockMovementService);
  }

  /**
   * GET /stock-movements/:productId/history?unit_business_id=...
   */
  getHistory = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { productId } = req.params;
      const { unit_business_id } = req.query;

      const history = await this.service.getProductHistory(
        productId as string,
        unit_business_id as string,
      );

      return res.status(200).json(history);
    } catch (error) {
      next(error);
    }
  };

  /**
   * GET /stock-movements/:productId/balance?unit_business_id=...
   */
  getBalance = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { productId } = req.params;
      const { unit_business_id } = req.query;

      const balance = await this.service.getCurrentBalance(
        productId as string,
        unit_business_id as string,
      );

      return res.status(200).json(balance);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /stock-movements/process
   * Endpoint de processamento em tempo real, chamado quando uma NF é confirmada.
   */
  process = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await this.service.processMovement(req.body);
      return res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /stock-movements/:productId/reindex
   * Dispara a re-indexação em lote (backfill ou lançamento retroativo).
   */
  reindex = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { productId } = req.params;
      const { unit_business_id, movements } = req.body;

      const result = await this.service.reindexProduct(productId as string, unit_business_id, movements);
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };
}

export default new StockMovementController();