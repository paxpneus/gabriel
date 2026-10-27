import { Request, Response } from "express";
import BaseController, { StoreNumberField } from "../../../../shared/utils/base-models/base-controller";
import StockMovement from "./stock-movements.model";
import StockMovementService from "./stock-movements.service";
import { authenticate } from "../../../../middlewares/auth-token";
import { userPermissions } from "../../../../middlewares/user-permissions";
import { validateCreate, validateUpdate } from "../../../../middlewares/validation";
import {
  CreateStockMovementSchema,
  UpdateStockMovementSchema,
} from "./schemas/stock-movement.schema";
import stockMovementsService from "./stock-movements.service";
import { QueryParams } from "../../../../shared/query/query.types";

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

  // ?store_number= de application filtra o index por unit_business_id.
  protected storeNumberField(): StoreNumberField {
    return "unit_business_id";
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
      createManualAdjustment: [
        authenticate,
        validateCreate(CreateStockMovementSchema),
        userPermissions,
      ],
      updateManualAverageCost: [
        authenticate,
        validateUpdate(UpdateStockMovementSchema),
        userPermissions,
      ],
      deactivate: [authenticate, userPermissions],
      reactivate: [authenticate, userPermissions],
      syncAll: [authenticate, userPermissions],
      // CRUD bulk do BaseController: sem chave aqui a rota ficava sem nenhum middleware.
      bulkCreate: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }

  /**
   * GET /stock-movements/:productId/history?unit_business_id=...
   */
  getHistory = async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      const { unit_business_id } = req.query;

      const params = this.extractQueryParams(req) as QueryParams;

      const history = await this.service.getProductHistory(
        productId as string,
        unit_business_id as string,
        params,
      );

      return res.status(200).json(history);
    } catch (error) {
      // Sem error middleware global no app: next(error) cairia no handler HTML default do Express.
      return res.status(500).json({ error: (error as Error).message });
    }
  };

  /**
   * GET /stock-movements/:productId/balance?unit_business_id=...
   */
  getBalance = async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      const { unit_business_id } = req.query;

      const balance = await this.service.getCurrentBalance(
        productId as string,
        unit_business_id as string,
      );

      return res.status(200).json(balance);
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  };

  /**
   * GET /stock-movements/:productId/source-data?unit_business_id=...
   * Lista as NFs "cruas" que alimentariam o Kardex (debug/preview antes do sync).
   */
  getSourceData = async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      const { unit_business_id } = req.query;

      const sourceData = await this.service.findStockMovementSourceData(
        unit_business_id as string,
        productId as string,
      );

      return res.status(200).json(sourceData);
    } catch (error) {
      return res.status(500).json({ error: (error as Error).message });
    }
  };

  /**
   * POST /stock-movements/process
   * Endpoint de processamento em tempo real, chamado quando uma NF é confirmada.
   */
  process = async (req: Request, res: Response) => {
    try {
      const result = await this.service.processMovement(req.body);
      return res.status(201).json(result);
    } catch (error) {
      return res.status(400).json({ error: (error as Error).message });
    }
  };

  /**
   * POST /stock-movements/:productId/reindex
   * ⚠️ Rota bruta: apaga e recria o histórico reconstruível. Só via ação
   * explícita de operador.
   */
  reindex = async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      const { unit_business_id, movements } = req.body;

      const result = await this.service.reindexProduct(
        productId as string,
        unit_business_id,
        movements,
        undefined,
        false,
      );
      return res.status(200).json(result);
    } catch (error) {
      return res.status(400).json({ error: (error as Error).message });
    }
  };

  /**
   * POST /stock-movements/:productId/sync
   * Sincroniza o Kardex a partir das NFs pendentes (fluxo normal ou retroativo).
   */
  sync = async (req: Request, res: Response) => {
    try {
      const { productId } = req.params;
      const { unit_business_id } = req.body;

      const result = await this.service.syncProductStockMovements(
        productId as string,
        unit_business_id,
      );
      return res.status(200).json(result);
    } catch (error) {
      return res.status(400).json({ error: (error as Error).message });
    }
  };

  /**
   * POST /stock-movements/:productId/upsert
   * Funde movimentos recebidos com os existentes e recalcula a cadeia,
   * sem apagar nada.
   */
  upsert = async (req: Request, res: Response) => {
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
      return res.status(400).json({ error: (error as Error).message });
    }
  };

  /**
   * POST /stock-movements/:productId/manual-adjustment
   * Cria um ajuste manual (sem invoice_id) e recalcula a cadeia a partir dele.
   * Body exige refers_to (invoice_number da PURCHASE_ENTRY que este ajuste
   * corrige) — protege a linha contra delete/recriação em reindexProduct.
   * Não aceita movement_date: a data é sempre calculada no service a partir
   * da PURCHASE_ENTRY referenciada (mesmo dia, 5s à frente dela).
   */
  createManualAdjustment = async (
    req: Request,
    res: Response,
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
      return res.status(400).json({ error: (error as Error).message });
    }
  };

  /**
   * PATCH /stock-movements/:productId/manual-average-cost/:movementId
   * ⚠️ Único ponto que escreve manual_average_cost_value. Body: { unit_business_id, manual_average_cost_value, refers_to }
   * manual_average_cost_value pode ser `null` pra remover o override (refers_to
   * é mantido); ajuste de saída (SALE_OUT) não aceita custo manual.
   * refers_to é o invoice_number da nota (PURCHASE_ENTRY ou SALE_OUT, conforme
   * a direção do ajuste); movement_date é recalculado (mesmo dia, 5s à frente dela).
   */
  updateManualAverageCost = async (
    req: Request,
    res: Response,
  ) => {
    try {
      const { productId, movementId } = req.params;
      const { unit_business_id, manual_average_cost_value, refers_to } =
        req.body;

      const result = await this.service.updateManualAverageCost(
        productId as string,
        unit_business_id,
        movementId as string,
        manual_average_cost_value,
        refers_to,
      );
      return res.status(200).json(result);
    } catch (error) {
      return res.status(400).json({ error: (error as Error).message });
    }
  };

  /**
   * PATCH /stock-movements/:productId/deactivate
   * Body: { unit_business_id, movement_ids: string[] }
   */
  deactivate = async (req: Request, res: Response) => {
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
      return res.status(400).json({ error: (error as Error).message });
    }
  };

  /**
   * PATCH /stock-movements/:productId/reactivate
   * Body: { unit_business_id, movement_ids: string[] }
   */
  reactivate = async (req: Request, res: Response) => {
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
      return res.status(400).json({ error: (error as Error).message });
    }
  };

  /**
   * POST /stock-movements/sync-all/:unitBusinessId
   * Backfill: varre todos os produtos do unit_business e cria os
   * stock_movements que estão faltando (NFs sem movimento correspondente).
   * Não apaga nem sobrescreve nada existente.
   */
  syncAll = async (req: Request, res: Response) => {
    try {
      const { unitBusinessId } = req.params;

      const result = await this.service.manualSyncAllProductsStockMovements(
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
      return res.status(400).json({ error: (error as Error).message });
    }
  };
}

export default new StockMovementController();
