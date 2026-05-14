export type UserTheme = "dark" | "light";

export interface UserConfigAttributes {
  id: string;
  user_id: string;
  theme: UserTheme;
  profile_photo?: string | null;
  language: string;
  timezone: string;
  items_per_page: number;
  notifications_enabled: boolean;
  visualize_only_current_unit_business: boolean;
  compact_mode: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserConfigCreationAttributes
  extends Omit<
    UserConfigAttributes,
    | "id"
    | "theme"
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
  profile_photo?: string | null;
  language?: string;
  timezone?: string;
  items_per_page?: number;
  notifications_enabled?: boolean;
  visualize_only_current_unit_business?: boolean;
  compact_mode?: boolean;
}
