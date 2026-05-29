import Role from "../../warehouse/users/roles/role.model";

export interface ApplicationAttributes {
  id: string;
  name: string;
  description?: string | null;
  role_id: string;
  api_key: string;
  api_secret_hash: string;
  allowed_routes: string[];
  rate_limit_max_requests: number;
  rate_limit_window_seconds: number;
  token_version: number;
  last_login_at?: Date | null;
  revoked_at?: Date | null;
  is_active: boolean;
  role?: Role;
}

export type ApplicationRequestAttributes = Omit<
  ApplicationAttributes,
  "api_secret_hash" | "role"
> & {
  role?: {
    id: string;
    name: string;
    permissions: {
      entity: string;
      permissions: string[];
    }[];
  };
};

export type ApplicationCreationAttributes = Omit<
  ApplicationAttributes,
  "id" | "api_key" | "api_secret_hash" | "token_version" | "role"
> & {
  api_key?: string;
  api_secret_hash?: string;
  token_version?: number;
};

export interface CreateApplicationInput {
  name: string;
  description?: string | null;
  role_id: string;
  allowed_routes?: string[];
  rate_limit_max_requests?: number;
  rate_limit_window_seconds?: number;
  is_active?: boolean;
}

export interface ApplicationCredentials {
  api_key: string;
  api_secret: string;
}

export interface ApplicationLoginInput {
  api_key: string;
  api_secret: string;
}

export interface ApplicationTokenPayload {
  id: string;
  role: string;
  type: "application";
  tokenVersion: number;
}
