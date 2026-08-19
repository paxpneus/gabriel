export interface PriorityAttributes { id: string; name: string; color?: string | null; display_order: number; sla_hours?: number | null; createdAt?: Date; updatedAt?: Date; }
export interface PriorityCreationAttributes extends Omit<PriorityAttributes, "id" | "createdAt" | "updatedAt"> {}
