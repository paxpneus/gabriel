import BaseService from '../../../shared/utils/base-models/base-service';
import User from './user.model';
import userRepository, { UserRepository } from './user.repository';

export class UserService extends BaseService<User, UserRepository> {
  constructor() {
    super(userRepository);
  }
}

export default new UserService();
