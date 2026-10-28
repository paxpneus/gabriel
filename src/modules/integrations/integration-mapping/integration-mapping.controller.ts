import { Request, Response } from 'express';
import BaseController, { StoreNumberField } from '../../../shared/utils/base-models/base-controller';
import { authenticate } from '../../../middlewares/auth-token';
import { userPermissions } from '../../../middlewares/user-permissions';
import IntegrationMapping from './integration-mapping.model';
import IntegrationMappingService from './integration-mapping.service';

// Sync automático nunca reaponta mapping (ver createOrUpdateIntegrationMapping); update/destroy genéricos ficam
// bloqueados e a correção manual só passa pelas rotas por produto (/product/:productId/:id).
const MAPPING_IS_IMMUTABLE_MESSAGE =
  'Integration mapping só pode ser alterado ou removido pelas rotas do produto (/product/:productId/:id).';

export class IntegrationMappingController extends BaseController<IntegrationMapping, typeof IntegrationMappingService> {
  constructor() {
    super(IntegrationMappingService);

    this.router.get(
      '/product/:productId',
      ...this.mw('findByProductId'),
      this.findByProductId,
    );
    this.router.post(
      '/product/:productId',
      ...this.mw('createForProduct'),
      this.createForProduct,
    );
    this.router.put(
      '/product/:productId/:id',
      ...this.mw('updateForProduct'),
      this.updateForProduct,
    );
    this.router.delete(
      '/product/:productId/:id',
      ...this.mw('deleteForProduct'),
      this.deleteForProduct,
    );
  }

  // GET /product/:productId — integration_mappings paginados do produto (entity_type PRODUCT).
  findByProductId = async (req: Request, res: Response): Promise<Response> => {
    try {
      const params = this.extractQueryParams(req);
      const result = await this.service.findByProductId(
        params,
        req.params.productId as string,
      );
      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // POST /product/:productId — cria mapping PRODUCT manual (body: integrations_id, external_id).
  createForProduct = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { integrations_id, external_id } = req.body;
      const record = await this.service.createForProduct(
        req.params.productId as string,
        { integrations_id, external_id },
      );
      return res.status(201).json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // PUT /product/:productId/:id — troca integrations_id/external_id e/ou marca is_primary (desmarca os outros); 404 se o mapping não for desse produto.
  updateForProduct = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { integrations_id, external_id, is_primary } = req.body;
      const record = await this.service.updateForProduct(
        req.params.id as string,
        req.params.productId as string,
        { integrations_id, external_id, is_primary },
        (req as any).user?.id ?? null,
        // Mesmas filas do import manual (queues/index.ts) — o sync do novo principal vai pra fila da integração.
        {
          blingApiFetch: req.app.locals.BlingApiFetchQueue,
          blingOrder: req.app.locals.BlingOrderQueue,
          tcarApiFetch: req.app.locals.TCarUpsertQueue,
          tcarInvoice: req.app.locals.TCarInvoiceQueue,
        },
      );
      if (!record) return res.status(404).json({ error: 'Não encontrado' });
      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // DELETE /product/:productId/:id — 404 se o mapping não for desse produto.
  deleteForProduct = async (req: Request, res: Response): Promise<Response> => {
    try {
      const deleted = await this.service.deleteForProduct(
        req.params.id as string,
        req.params.productId as string,
      );
      if (!deleted) return res.status(404).json({ error: 'Não encontrado' });
      return res.status(204).send();
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  // Sem middlewaresFor index/show/create ficavam abertos sem login (rota em EXCLUDED_ROUTES: só authenticate vale).
  // ?store_number= de application filtra o index por unit_business_id.
  protected storeNumberField(): StoreNumberField {
    return 'unit_business_id';
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
      findByProductId: [authenticate, userPermissions],
      createForProduct: [authenticate, userPermissions],
      updateForProduct: [authenticate, userPermissions],
      deleteForProduct: [authenticate, userPermissions],
    };
  }

  update = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(405).json({ error: MAPPING_IS_IMMUTABLE_MESSAGE });
  };

  bulkUpdate = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(405).json({ error: MAPPING_IS_IMMUTABLE_MESSAGE });
  };

  destroy = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(405).json({ error: MAPPING_IS_IMMUTABLE_MESSAGE });
  };

  bulkDestroy = async (_req: Request, res: Response): Promise<Response> => {
    return res.status(405).json({ error: MAPPING_IS_IMMUTABLE_MESSAGE });
  };
}

export default new IntegrationMappingController();
