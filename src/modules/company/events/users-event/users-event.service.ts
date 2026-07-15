import BaseService from '../../../../shared/utils/base-models/base-service';
import UserEvent from './users-event.model';
import userEventRepository, { UserEventRepository } from './users-event.repository';

export class UserEventService extends BaseService<UserEvent, UserEventRepository> {
  constructor() {
    super(userEventRepository);
  }
}

export default new UserEventService();
