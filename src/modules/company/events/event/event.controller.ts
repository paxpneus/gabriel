import { Request, Response } from 'express';
import BaseController from '../../../../shared/utils/base-models/base-controller';
import Event from './event.model';
import eventService, { EventService } from './event.service';
import { authenticate } from '../../../../middlewares/auth-token';
import { userPermissions } from '../../../../middlewares/user-permissions';
import { getUserContext } from '../../../../shared/query/get-logged-user';

export class EventController extends BaseController<Event, EventService> {
  constructor() {
    super(eventService);
    this.registerCustomRoutes();
  }

  private registerCustomRoutes(): void {
    this.router.get(
      '/unread/get',
      ...this.mw('getUnreadEvents'),
      (req, res) => this.getUnreadEvents(req, res),
    );

    this.router.post(
      '/read',
      ...this.mw('markAsRead'),
      (req, res) => this.markAsRead(req, res),
    );
  }

  protected middlewaresFor() {
    return {
      index:    [authenticate, userPermissions],
      create:   [authenticate, userPermissions],
      update:   [authenticate, userPermissions],
      show:     [authenticate, userPermissions],
      destroy:  [authenticate, userPermissions],
      getUnreadEvents:   [authenticate],
      markAsRead: [authenticate],
    };
  }

  getUnreadEvents = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { userId } = await getUserContext(req)
      if (!userId) return res.status(401).json({ error: 'Não autenticado.' });

      const events = await this.service.unreadEventsByUser(userId);
      return res.json(events);
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };

  markAsRead = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { userId } = await getUserContext(req)
      if (!userId) return res.status(401).json({ error: 'Não autenticado.' });

      const { eventIds } = req.body
      await this.service.markAsRead(eventIds as string[], userId);
      return res.json({ success: true });
    } catch (error: any) {
      return res.status(500).json({ error: error.message });
    }
  };
}

export default new EventController();
