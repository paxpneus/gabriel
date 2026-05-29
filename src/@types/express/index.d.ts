// types/express.d.ts
import { ApplicationRequestAttributes } from "../../modules/integrations/applications/applications.types";

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: string };
      application?: ApplicationRequestAttributes;
    }
  }
}

export {}; 
