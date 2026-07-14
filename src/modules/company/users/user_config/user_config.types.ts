import { USER_TYPE_CONFIG } from "../../../../shared/constants/user-types";

export type UserTheme = "dark" | "light";

export type UserType = "admin" | "stock-requester" | "operator" | "manager" | "seller" | (string & {});

export interface UserConfigAttributes {
  id: string;
  user_id: string;
  theme: UserTheme;
  type?: UserType
  type_permissions?: USER_TYPE_CONFIG
  profile_photo?: string | null;
  language: string;
  timezone: string;
  items_per_page: number;
  notifications_enabled: boolean;
  visualize_only_current_unit_business: boolean;
  compact_mode: boolean;
  auto_advance_collector?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserConfigCreationAttributes
  extends Omit<
    UserConfigAttributes,
    | "id"
    | "theme"
    | "type"
    | "profile_photo"
    | "language"
    | "timezone"
    | "items_per_page"
    | "notifications_enabled"
    | "visualize_only_current_unit_business"
    | "compact_mode"
    | "createdAt"
    | "updatedAt"
  > {
  theme?: UserTheme;
  type?: UserType
  profile_photo?: string | null;
  language?: string;
  timezone?: string;
  items_per_page?: number;
  notifications_enabled?: boolean;
  visualize_only_current_unit_business?: boolean;
  compact_mode?: boolean;
}
