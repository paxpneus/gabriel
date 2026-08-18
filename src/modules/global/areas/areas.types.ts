export interface AreaAttributes { id: number; name: string; color?: string | null; is_active: boolean; createdAt?: Date; updatedAt?: Date; }
export interface AreaCreationAttributes extends Omit<AreaAttributes, "id" | "createdAt" | "updatedAt"> {}
