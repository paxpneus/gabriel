import { Request, Response } from 'express';
import BaseController from '../../../shared/utils/base-models/base-controller';
import SupplierMapping from './supplier-mapping.model';
import SupplierMappingService from './supplier-mapping.service';
import { authenticate } from '../../../middlewares/auth-token';
import { userPermissions } from '../../../middlewares/user-permissions';
import { getUserContext } from '../../../shared/query/get-logged-user';
import { resolveIntegrationsIdForUnitBusiness } from '../../handlers/tecinco/queues/helpers/product.helpers';

export class SupplierMappingController extends BaseController<SupplierMapping, typeof SupplierMappingService> {
  constructor() {
    super(SupplierMappingService);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      bulkCreate: [authenticate, userPermissions],
      bulkUpdate: [authenticate, userPermissions],
      bulkDestroy: [authenticate, userPermissions],
    };
  }

  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { unitBusinessId } = await getUserContext(req);
      const integrationsId = await resolveIntegrationsIdForUnitBusiness(unitBusinessId);

      const record = await this.service.create({
        ...req.body,
        integrations_id: integrationsId,
      });

      return res.status(201).json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new SupplierMappingController();
