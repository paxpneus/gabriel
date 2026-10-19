import { Request, Response } from 'express';
import BaseController, { StoreNumberField } from '../../../shared/utils/base-models/base-controller';
import { authenticate } from '../../../middlewares/auth-token';
import { userPermissions } from '../../../middlewares/user-permissions';
import IntegrationMapping from './integration-mapping.model';
import IntegrationMappingService from './integration-mapping.service';

// Um integration_mapping é criado uma única vez pelo sistema e nunca mais
// tocado (ver createOrUpdateIntegrationMapping) — por isso as rotas de
// update/destroy genéricas do BaseController são desabilitadas aqui, senão
// dariam um jeito de burlar essa regra direto pela API.
const MAPPING_IS_IMMUTABLE_MESSAGE =
  'Integration mapping não pode ser atualizado ou removido pela API — é criado uma única vez pelo sistema.';

export class IntegrationMappingController extends BaseController<IntegrationMapping, typeof IntegrationMappingService> {
  constructor() {
    super(IntegrationMappingService);
  }

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
