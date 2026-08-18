export interface CategoryOptionAttributes { id: number; category_id: number; label: string; value?: string | null; color?: string | null; display_order: number; is_active: boolean; createdAt?: Date; updatedAt?: Date; }
export interface CategoryOptionCreationAttributes extends Omit<CategoryOptionAttributes, "id" | "createdAt" | "updatedAt"> {}
