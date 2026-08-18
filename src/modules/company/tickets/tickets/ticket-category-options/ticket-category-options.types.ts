import CategoryOption from "../config/categories/category_options/category-options.model";
import TicketCategoryOption from "./ticket-category-options.model";

export interface TicketCategoryOptionAttributes {
  ticket_id: string;
  category_option_id: number;
}
export interface TicketCategoryOptionCreationAttributes extends TicketCategoryOptionAttributes {}

export interface FullTicketCategoryOption extends TicketCategoryOption {
    categoryOption: CategoryOption
}