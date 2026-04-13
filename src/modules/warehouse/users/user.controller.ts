import BaseController from '../../../shared/utils/base-models/base-controller';
import User from './user.model';
import UserService from './user.service';

export class UserController extends BaseController<User, typeof UserService> {
  constructor() {
    super(UserService);
  }
}

export default new UserController();
