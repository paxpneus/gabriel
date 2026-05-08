import { Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import redisService from "../shared/utils/base-models/base-redis";
import userService from "../modules/warehouse/users/users/user.service";
import { AuthRequest } from "./auth-token";
import { ROLE_PERMISSIONS, RoleType } from "../shared/constants/roles";
import { resolveEntityFromRoute } from "../config/routes";

type Actions = "read" | "write" | "delete" | "update";

const METHOD_ACTION_MAP: Record<string, Actions> = {
  GET: "read",
  POST: "write",
  PUT: "update",
  PATCH: "update",
  DELETE: "delete",
};

const ACTION_LABEL: Record<Actions, string> = {
  write: "Criar",
  read: "Visualizar",
  update: "Atualizar",
  delete: "Remover",
};

const MODEL_LABEL = (entity: string): string => {
  const parent = ROLE_PERMISSIONS.find((r) => r.entity === entity);
  if (parent) return parent.scope;

  for (const role of ROLE_PERMISSIONS) {
    const child = role.children?.find((c) => c.entity === entity);
    if (child) return `${role.scope} › ${child.label}`;
  }

  return entity;
};

function resolvePermissionEntity(entity: string): { entity: string; type: RoleType } {
  const primary = ROLE_PERMISSIONS.find((r) => r.entity === entity);
  if (primary) return { entity: primary.entity, type: primary.type };

  for (const role of ROLE_PERMISSIONS) {
    const isChild = role.children?.find((c) => c.entity === entity);
    if (isChild) return { entity: role.entity, type: role.type };
  }

  return { entity, type: 'REGULAR' };
}

function userHasPermission(
  role: any,
  entity: string,
  action: Actions,
): boolean {
  if (!role?.permissions) return false;

  const { entity: permEntity, type } = resolvePermissionEntity(entity);

  for (const perm of role.permissions) {
    if (perm === "*") return true;

    if (type === 'CUSTOM') {
      if (perm.entity === permEntity && perm.permissions.includes(action)) return true;
    } else {
      if (perm.entity === permEntity && perm.permissions.includes(action)) return true;
    }
  }

  return false;
}

export async function userPermissions(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const token = req.cookies?.token;
    if (!token)
      return res.status(401).json({ message: "Token não encontrado." });

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      role: string;
    };

    let userCached = await redisService.get(`user:${decoded.id}`);

    if (!userCached) {
      const user = await userService.getMe(token);
      userCached = user;
    }

    const user =
      typeof userCached === "string" ? JSON.parse(userCached) : userCached;
    if (!user)
      return res.status(401).json({ message: "Usuário não encontrado." });

    const action = METHOD_ACTION_MAP[req.method];
    if (!action)
      return res.status(400).json({ message: "Método HTTP inválido." });

    const entity = resolveEntityFromRoute(req.originalUrl);
    if (!entity) return next();

    const { type } = resolvePermissionEntity(entity);

    if (type === 'CUSTOM') {
      
    }

    if (!userHasPermission(user.role, entity, action)) {
      const scope =
        ROLE_PERMISSIONS.find((s) => s.entity === entity)?.scope ?? entity;

      return res.status(400).json({
        error: `Acesso negado: sem permissão de "${ACTION_LABEL[action]}" em "${MODEL_LABEL(scope)}".`,
      });
    }

    req.user = { id: decoded.id, role: decoded.role };
    next();
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: "Token inválido." });
    }
    return res.status(500).json({ message: "Erro interno no middleware." });
  }
}
