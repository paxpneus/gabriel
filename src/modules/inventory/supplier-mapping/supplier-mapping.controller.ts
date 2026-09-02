import { Request, Response } from 'express';
import { Op } from 'sequelize';
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

  private async resolveIntegrationsId(req: Request): Promise<string> {
    const { unitBusinessId } = await getUserContext(req);
    return resolveIntegrationsIdForUnitBusiness(unitBusinessId);
  }

  index = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);
      const params = this.extractQueryParams(req);

      const result = await this.service.paginate(params, undefined, {
        integrations_id: integrationsId,
      });

      return res.json(result);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  show = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);

      const record = await this.service.findById(req.params.id as string);
      if (!record || record.integrations_id !== integrationsId) {
        return res.status(404).json({ error: 'Não encontrado' });
      }

      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  create = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);

      const record = await this.service.create({
        ...req.body,
        integrations_id: integrationsId,
      });

      return res.status(201).json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  update = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);

      const existing = await this.service.findById(req.params.id as string);
      if (!existing || existing.integrations_id !== integrationsId) {
        return res.status(404).json({ error: 'Não encontrado' });
      }

      const { integrations_id, ...data } = req.body;

      const record = await this.service.update(req.params.id as string, data);
      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  destroy = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);

      const existing = await this.service.findById(req.params.id as string);
      if (!existing || existing.integrations_id !== integrationsId) {
        return res.status(404).json({ error: 'Não encontrado' });
      }

      await this.service.delete(req.params.id as string);
      return res.status(204).send();
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  bulkCreate = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);
      const items = req.body as Array<Record<string, unknown>>;

      const records = await this.service.bulkCreate(
        items.map((item) => ({
          ...item,
          integrations_id: integrationsId,
        })) as any,
      );

      return res.status(201).json(records);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  bulkUpdate = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);
      const { ids, integrations_id, ...data } = req.body;

      const records = await this.service.bulkUpdate(data, {
        where: {
          [Op.and]: [{ id: ids }, { integrations_id: integrationsId }],
        },
      });

      return res.status(201).json(records);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };

  bulkDestroy = async (req: Request, res: Response): Promise<Response> => {
    try {
      const integrationsId = await this.resolveIntegrationsId(req);
      const { ids } = req.body as { ids: string[] };

      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Informe um array de ids válido.' });
      }

      const deleted = await this.service.bulkDelete({
        where: {
          id: { [Op.in]: ids },
          integrations_id: integrationsId,
        },
      });

      return res.json({ deleted });
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new SupplierMappingController();
