import BaseService from '../../../../shared/utils/base-models/base-service';
import Event from './event.model';
import eventRepository, { EventRepository } from './event.repository';
import userService from '../../users/users/user.service';
import userEventService from '../users-event/users-event.service';
import sequelize from '../../../../config/sequelize';
import { Op, Transaction } from 'sequelize';
import socketService from '../../../handlers/socket/services/socket.service';
import { EventAttributes, EventWithReadStatus, NotifyByUserTypeParams } from './event.types';
import redisService from '../../../../shared/utils/base-models/base-redis';
const NOTIFICATION_SOCKET_EVENT = 'event:created' as const;

export class EventService extends BaseService<Event, EventRepository> {
  constructor() {
    super(eventRepository);

    this.queryConfig = {
      filterableFields: ['id'],
      sortableFields: ['title', 'description', 'createdAt'],
      searchFields: ['title', 'description'],
      defaults: {
        perPage: 20,
        sortBy: 'createdAt',
        sortDir: 'DESC',
      },
    };
  }

  private unreadEventsCacheKey(userId: string): string {
    return `events:unread:${userId}`;
  }

  async unreadEventsByUser(userId: string): Promise<EventWithReadStatus[]> {
    const cacheKey = this.unreadEventsCacheKey(userId);

    const cached = await redisService.get<EventWithReadStatus[]>(cacheKey);
    if (cached !== null) {
      return cached;
    }

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const userEvents = await userEventService.findAll({
      where: {
        user_id: userId,
        [Op.or]: [
          { read_at: null },
          { read_at: { [Op.gte]: oneDayAgo } },
        ],
      },
      include: [{ association: 'event', required: true }],
    });

    const events: EventWithReadStatus[] = userEvents
      .filter((userEvent) => userEvent.event !== undefined)
      .map((userEvent) => {
        const plainEvent = userEvent.event!.get({ plain: true });
        return {
          ...plainEvent,
          read_at: userEvent.read_at,
        };
      });

    await redisService.set(cacheKey, events, { mode: 'EX', duration: 60 });

    return events;
  }

  async markAsRead(eventId: string, userId: string): Promise<void> {

    const userEvent = await userEventService.findOne({
      where: {
        event_id: eventId,
        user_id: userId,
      }
    })

    if (!userEvent) {
      throw new Error('Não autorizado.')
    }

    await userEventService.update(userEvent.id, {
      read_at: new Date(),
    })

    redisService.delete(this.unreadEventsCacheKey(userId))
  }

  async dispatchNotification(
    userIds: string[],
    socketEvent: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    if (userIds.length === 0) return;

    await Promise.all(
      userIds.map((userId) => redisService.delete(this.unreadEventsCacheKey(userId))),
    );

    this.emitEventToUsers(userIds, socketEvent, payload);
  }


  async notifyByRoles({
    types,
    unitBusinessId,
    title,
    description,
    transaction,
  }: NotifyByUserTypeParams): Promise<{ eventId: string; userIds: string[] }> {
    const isExternalTransaction = !!transaction;
    const t = transaction ?? (await sequelize.transaction());

    try {
      const users = await userService.findAll({
        where: { unit_business_id: unitBusinessId },
        include: [{ association: 'config', where: { type: types }, attributes: ['id'], required: true }],
        transaction: t,
      });

      const userIds = users.map((u) => u.id);

      if (userIds.length === 0) {
        if (!isExternalTransaction) await t.commit();
        return { eventId: '', userIds: [] };
      }

      const event = await this.repository.create({ title, description: description ?? null }, { transaction: t });

      await userEventService.bulkCreate(
        userIds.map((userId) => ({ user_id: userId, event_id: event.id })),
        { transaction: t },
      );

      t.afterCommit(() => {
        this.dispatchNotification(userIds, NOTIFICATION_SOCKET_EVENT, {
          event: {
            id: event.id,
            title: event.title,
            description: event.description,
            createdAt: event.createdAt,
            read_at: null,
          },
        }).catch((err) => console.error('[EventService] Falha ao despachar notificação:', err));
      });

      if (!isExternalTransaction) await t.commit();


      return { eventId: event.id, userIds };
    } catch (err) {
      if (!isExternalTransaction) await t.rollback();
      throw err;
    }
  }

  emitEventToUsers(userIds: string[], socketEvent: string, payload: Record<string, unknown>): void {
    for (const userId of userIds) {
      socketService.emitToUser(userId, socketEvent, payload);
    }
  }
}

export default new EventService();