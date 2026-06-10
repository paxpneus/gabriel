export interface MagentoAttributePayload {
  attribute_code: string;
  frontend_input:
    | "text"
    | "textarea"
    | "date"
    | "boolean"
    | "multiselect"
    | "select"
    | "price"
    | "weight"
    | "media_image";
  scope?: "global" | "website" | "store";
  default_frontend_label: string;
  is_visible_on_front?: boolean;
  is_used_in_grid?: boolean;
  [key: string]: unknown;
}