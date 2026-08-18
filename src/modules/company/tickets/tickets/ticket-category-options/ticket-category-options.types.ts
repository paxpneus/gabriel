import CategoryOption from "../config/categories/category-options/category-options.model";
import TicketCategoryOption from "./ticket-category-options.model";

export interface TicketCategoryOptionAttributes {
  ticket_id: string;
  category_option_id: string;
}
export interface TicketCategoryOptionCreationAttributes extends TicketCategoryOptionAttributes {}

export interface FullTicketCategoryOption extends TicketCategoryOption {
  categoryOption: CategoryOption;
}
