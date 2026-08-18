export interface TicketStatusAttributes { id: string; name: string; color?: string | null; completed: boolean; canceled: boolean; display_order: number; is_active: boolean; createdAt?: Date; updatedAt?: Date; }
export interface TicketStatusCreationAttributes extends Omit<TicketStatusAttributes, "id" | "createdAt" | "updatedAt"> {}
