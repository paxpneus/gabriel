import BaseController from '../../../../shared/utils/base-models/base-controller';
import User from './user.model';
import UserService from './user.service';
import { validateCreate, validateUpdate, validateId } from '../../../../middlewares/validation';
import { CreateUserSchema, UpdateUserSchema, UserIdSchema } from '../../../../shared/schemas';
import { Request, Response } from 'express';

export class UserController extends BaseController<User, typeof UserService> {
  constructor() {
    super(UserService);
  }
 
   protected middlewaresFor() {
    return {
      create:  [validateCreate(CreateUserSchema)],
      update:  [validateId(UserIdSchema), validateUpdate(UpdateUserSchema)],
      show:    [validateId(UserIdSchema)],
      destroy: [validateId(UserIdSchema)],
    };
  }

  create = async (req: Request, res: Response): Promise<Response> => {
    
    try {
      const record = await this.service.createUserWithValidation(req.body);
      return res.status(201).json(record);
    } catch (error: any) {

      return res.status(400).json({ error: error.message });
    }
  };

  update = async (req: Request, res: Response): Promise<Response> => {
    try {
      const record = await this.service.updateUserWithValidation(req.params.id as string, req.body);
      if (!record) return res.status(404).json({ error: 'Não encontrado' });
      return res.json(record);
    } catch (error: any) {
      return res.status(400).json({ error: error.message });
    }
  };
}

export default new UserController();
