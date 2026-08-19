export interface SubtaskAttributes { id: string; ticket_id: string; description: string; is_completed: boolean; completed_at?: Date | null; display_order: number; createdAt?: Date; updatedAt?: Date; }
export interface SubtaskCreationAttributes extends Omit<SubtaskAttributes, "id" | "createdAt" | "updatedAt"> {}
