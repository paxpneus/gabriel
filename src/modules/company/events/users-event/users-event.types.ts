import { EventAttributes } from "../event/event.types";

export interface UserEventAttributes {
  id: string;
  user_id: string;
  event_id: string;
  read_at?: Date | null;
  event?: EventAttributes | null;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserEventCreationAttributes extends Omit<UserEventAttributes, 'id' | 'createdAt' | 'updatedAt' | 'event'> {}
