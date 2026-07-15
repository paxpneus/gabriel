import BaseController from '../../../../shared/utils/base-models/base-controller';
import UserEvent from './users-event.model';
import UserEventService from './users-event.service';
import { authenticate } from '../../../../middlewares/auth-token';
import { userPermissions } from '../../../../middlewares/user-permissions';

export class UserEventController extends BaseController<UserEvent, typeof UserEventService> {
  constructor() {
    super(UserEventService);
  }

  protected middlewaresFor() {
    return {
      index: [authenticate, userPermissions],
      create: [authenticate, userPermissions],
      update: [authenticate, userPermissions],
      show: [authenticate, userPermissions],
      destroy: [authenticate, userPermissions],
    };
  }
}

export default new UserEventController();
