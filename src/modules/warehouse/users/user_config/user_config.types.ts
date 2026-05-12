export type UserTheme = "dark" | "light";

export interface UserConfigAttributes {
  id: string;
  user_id: string;
  theme: UserTheme;
  profile_photo?: string;
  language: string;
  timezone: string;
  items_per_page: number;
  notifications_enabled: boolean;
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
    | "compact_mode"
    | "createdAt"
    | "updatedAt"
  > {
  theme?: UserTheme;
  profile_photo?: string;
  language?: string;
  timezone?: string;
  items_per_page?: number;
  notifications_enabled?: boolean;
  compact_mode?: boolean;
}
