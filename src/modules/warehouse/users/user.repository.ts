import BaseRepository from '../../../shared/utils/base-models/base-repository';
import User from './user.model';

export class UserRepository extends BaseRepository<User> {
  constructor() {
    super(User);
  }
}

export default new UserRepository();
