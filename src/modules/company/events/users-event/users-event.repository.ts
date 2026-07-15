import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import UserEvent from './users-event.model';

export class UserEventRepository extends BaseRepository<UserEvent> {
  constructor() {
    super(UserEvent);
  }
}

export default new UserEventRepository();
