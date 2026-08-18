export interface TicketAttributes {
  id: string;
  title: string;
  description: string;
  requester_user_id: string;
  area_id: number;
  priority_id: number;
  status_id: number;
  completed_at?: Date | null;
  due_date?: Date | null;
  is_late: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
export interface TicketCreationAttributes extends Omit<
  TicketAttributes,
  "id" | "createdAt" | "updatedAt"
> {}
