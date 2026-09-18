import { Request, Response } from 'express';
import { authenticate } from '../../../middlewares/auth-token';
import { userPermissions } from '../../../middlewares/user-permissions';
import BaseController from '../../../shared/utils/base-models/base-controller';
import IntegrationError from './integration-error.model';
import IntegrationErrorService from './integration-error.service';

export class IntegrationErrorController extends BaseController<
  IntegrationError,
  typeof IntegrationErrorService
> {
  constructor() {
    super(IntegrationErrorService);

    this.router.put('/:id/resolve', ...this.mw('resolve'), this.resolve);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
      resolve: [authenticate, userPermissions],
    };
  }

  resolve = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.resolve(req.params.id as string);
      if (!record) return res.status(404).json({ error: 'Não encontrado' });
      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new IntegrationErrorController();
