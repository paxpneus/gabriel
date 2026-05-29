// types/express.d.ts
import { Request } from 'express';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: string };
      application?: {
        id: string;
        name: string;
        role_id: string;
        allowed_routes: string[];
        rate_limit_max_requests: number;
        rate_limit_window_seconds: number;
        token_version: number;
        is_active: boolean;
        role?: {
          id: string;
          name: string;
          permissions: {
            entity: string;
            permissions: string[];
          }[];
        };
      };
    }
  }
}

export {}; 
