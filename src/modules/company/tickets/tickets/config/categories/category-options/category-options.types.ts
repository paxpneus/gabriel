import Category from "../category/categories.model";

export interface CategoryOptionAttributes {
  id: string;
  category_id: string;
  label: string;
  value?: string | null;
  color?: string | null;
  display_order: number;
  categoey?: Category;
  is_active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}
export interface CategoryOptionCreationAttributes extends Omit<
  CategoryOptionAttributes,
  "id" | "createdAt" | "updatedAt"
> {}

export interface CategoryOptionUpdateAttributes extends Omit<
  CategoryOptionAttributes,
  "createdAt" | "updatedAt"
> {}
