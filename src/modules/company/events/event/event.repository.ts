import BaseRepository from '../../../../shared/utils/base-models/base-repository';
import Event from './event.model';

export class EventRepository extends BaseRepository<Event> {
  constructor() {
    super(Event);
  }
}

export default new EventRepository();
