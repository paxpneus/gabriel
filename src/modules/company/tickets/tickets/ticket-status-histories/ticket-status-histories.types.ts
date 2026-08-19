export interface TicketStatusHistoryAttributes {
  id: string;
  ticket_id: string;
  status_id: string;
  changed_by_user_id?: string | null;
  changed_at: Date;
}
export interface TicketStatusHistoryCreationAttributes extends Omit<
  TicketStatusHistoryAttributes,
  "id"
> {}
