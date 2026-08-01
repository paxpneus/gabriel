import { Request, Response, NextFunction } from "express";
import BaseController from "../../../../shared/utils/base-models/base-controller";
import StockMovement from "./stock-movements.model";
import StockMovementService from "./stock-movements.service";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import stockMovementsService from "./stock-movements.service";

export class StockMovementController extends BaseController<
  StockMovement,
  typeof StockMovementService
> {
  constructor() {
    super(stockMovementsService);

    this.router.get(
      "/:productId/history",
      ...this.mw("getHistory"),
      this.getHistory,
    );
    this.router.get(
      "/:productId/balance",
      ...this.mw("getBalance"),
      this.getBalance,
    );
    this.router.get(
      "/:productId/source-data",
      ...this.mw("getSourceData"),
      this.getSourceData,
    );

    this.router.post("/process", ...this.mw("process"), this.process);
    this.router.post(
      "/:productId/reindex",
      ...this.mw("reindex"),
      this.reindex,
    );
    this.router.post("/:productId/sync", ...this.mw("sync"), this.sync);
    this.router.post("/:productId/upsert", ...this.mw("upsert"), this.upsert);
    this.router.post(
      "/:productId/manual-adjustment",
      ...this.mw("createManualAdjustment"),
      this.createManualAdjustment,
    );

    this.router.patch(
      "/:productId/manual-average-cost/:movementId",
      ...this.mw("updateManualAverageCost"),
      this.updateManualAverageCost,
    );
    this.router.patch(
      "/:productId/deactivate",
      ...this.mw("deactivate"),
      this.deactivate,
    );
    this.router.patch(
      "/:productId/reactivate",
      ...this.mw("reactivate"),
      this.reactivate,
    );

    this.router.post(
      "/sync-all/:unitBusinessId",
      ...this.mw("syncAll"),
      this.syncAll,
    );
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      getHistory: [authenticate, userPermissions],
      getBalance: [authenticate, userPermissions],
      getSourceData: [authenticate, userPermissions],
      process: [authenticate, userPermissions],
      reindex: [authenticate, userPermissions],
      sync: [authenticate, userPermissions],
      upsert: [authenticate, userPermissions],
      createManualAdjustment: [authenticate, userPermissions],
      updateManualAverageCost: [authenticate, userPermissions],
      deactivate: [authenticate, userPermissions],
      reactivate: [authenticate, userPermissions],
      syncAll: [],
    };
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
   * GET /stock-movements/:productId/source-data?unit_business_id=...
   * Lista as NFs "cruas" que alimentariam o Kardex (debug/preview antes do sync).
   */
  getSourceData = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { productId } = req.params;
      const { unit_business_id } = req.query;

      const sourceData = await this.service.findStockMovementSourceData(
        unit_business_id as string,
        productId as string,
      );

      return res.status(200).json(sourceData);
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
   * ⚠️ Rota bruta: apaga e recria o histórico reconstruível. Só via ação
   * explícita de operador.
   */
  reindex = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { productId } = req.params;
      const { unit_business_id, movements } = req.body;

      const result = await this.service.reindexProduct(
        productId as string,
        unit_business_id,
        movements,
      );
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /stock-movements/:productId/sync
   * Sincroniza o Kardex a partir das NFs pendentes (fluxo normal ou retroativo).
   */
  sync = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { productId } = req.params;
      const { unit_business_id } = req.body;

      const result = await this.service.syncProductStockMovements(
        productId as string,
        unit_business_id,
      );
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /stock-movements/:productId/upsert
   * Funde movimentos recebidos com os existentes e recalcula a cadeia,
   * sem apagar nada.
   */
  upsert = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { productId } = req.params;
      const { unit_business_id, movements } = req.body;

      const result = await this.service.upsertProductStockMovements(
        productId as string,
        unit_business_id,
        movements ?? [],
      );
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /stock-movements/:productId/manual-adjustment
   * Cria um ajuste manual (sem invoice_id) e recalcula a cadeia a partir dele.
   */
  createManualAdjustment = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { productId } = req.params;
      const { unit_business_id, ...payload } = req.body;

      const result = await this.service.createManualAdjustment(
        productId as string,
        unit_business_id,
        payload,
      );
      return res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /stock-movements/:productId/manual-average-cost/:movementId
   * ⚠️ Único ponto que escreve manual_average_cost_value. Body: { unit_business_id, manual_average_cost_value }
   * manual_average_cost_value pode ser `null` pra remover o override.
   */
  updateManualAverageCost = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    try {
      const { productId, movementId } = req.params;
      const { unit_business_id, manual_average_cost_value } = req.body;

      const result = await this.service.updateManualAverageCost(
        productId as string,
        unit_business_id,
        movementId as string,
        manual_average_cost_value,
      );
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /stock-movements/:productId/deactivate
   * Body: { unit_business_id, movement_ids: string[] }
   */
  deactivate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { productId } = req.params;
      const { unit_business_id, movement_ids } = req.body;

      const result = await this.service.deactivateStockMovements(
        productId as string,
        unit_business_id,
        movement_ids ?? [],
      );
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * PATCH /stock-movements/:productId/reactivate
   * Body: { unit_business_id, movement_ids: string[] }
   */
  reactivate = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { productId } = req.params;
      const { unit_business_id, movement_ids } = req.body;

      const result = await this.service.reactivateStockMovements(
        productId as string,
        unit_business_id,
        movement_ids ?? [],
      );
      return res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  };

  /**
   * POST /stock-movements/sync-all/:unitBusinessId
   * Backfill: varre todos os produtos do unit_business e cria os
   * stock_movements que estão faltando (NFs sem movimento correspondente).
   * Não apaga nem sobrescreve nada existente.
   */
  syncAll = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { unitBusinessId } = req.params;

      const result = await this.service.syncAllProductsStockMovements(
        unitBusinessId as string,
      );
      return res.status(200).json(result);
    } catch (error: any) {
      console.error("[SYNC_ALL] Erro real:", {
        message: error?.message,
        parent: error?.parent?.message,
        original: error?.original?.message,
        sql: error?.sql,
      });
      next(error);
    }
  };
}

export default new StockMovementController();
