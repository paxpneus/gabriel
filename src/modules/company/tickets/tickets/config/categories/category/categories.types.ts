import CategoryOption from "../category_options/category-options.model";

export interface CategoryAttributes {
  id: number;
  name: string;
  description?: string | null;
  color?: string | null;
  is_active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
export interface CategoryCreationAttributes extends Omit<
  CategoryAttributes,
  "id" | "createdAt" | "updatedAt"
> {}

export interface CategoryWithOptions extends CategoryAttributes {
    options?: CategoryOption[] | null
}
