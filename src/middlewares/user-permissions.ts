import { ROLE_PERMISSIONS } from './../shared/constants/roles';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import redisService from '../shared/utils/base-models/base-redis';
import userService from '../modules/warehouse/users/users/user.service';
import { AuthRequest } from './auth-token';

type Actions = 'read' | 'write' | 'delete' | 'update';

const METHOD_ACTION_MAP: Record<string, Actions> = {
  GET:    'read',
  POST:   'write',
  PUT:    'update',
  PATCH:  'update',
  DELETE: 'delete',
};

const translateActions = {
    write: 'Criar',
    read: 'Visualizar',
    update: 'Atualizar',
    delete: 'Remover'
}

function extractEntityFromPath(path: string): string | null {
  const segments = path.split('?')[0].split('/').filter(Boolean);
 console.log('segmento', path)
  const ignoredPrefixes = new Set(['api', 'v1', 'v2', 'v3']);

  for (const segment of segments) {
    if (!ignoredPrefixes.has(segment)) {
      return segment; 
    }
  }

  return null;
}

function resolveEntity(rawEntity: string): string {
  const directMatch = ROLE_PERMISSIONS.find(r => r.entity === rawEntity);
  if (directMatch) return rawEntity;

  for (const role of ROLE_PERMISSIONS) {
    if (role.children?.some(c => c.entity === rawEntity)) {
      return role.entity;
    }
  }

  return rawEntity;
}

function userHasPermission(
  role: any,
  entity: string,
  action: Actions
): boolean {
  if (!role?.permissions) return false;

  for (const perm of role.permissions) {
    if (perm === '*') return true;
    if (perm.entity === entity && perm.permissions.includes(action)) {
      return true;
    }
  }

  return false;
}

export async function userPermissions(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const token = req.cookies?.token;

    if (!token) {
      return res.status(401).json({ message: 'Token não encontrado.' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      id: string;
      role: string;
    };

    let userCached = await redisService.get(`user:${decoded.id}`);

    if (!userCached) {
      const userFromDb = await userService.getMe(token);
      userCached = await redisService.set(`user:${decoded.id}`, userFromDb);
    }

    console.log('cacheado', userCached)

    const user = typeof userCached === 'string'
      ? JSON.parse(userCached)
      : userCached;

    if (!user) {
      return res.status(401).json({ message: 'Usuário não encontrado.' });
    }

    const rawEntity = extractEntityFromPath(req.originalUrl);
    const action = METHOD_ACTION_MAP[req.method];
    console.log(rawEntity, action)
    if (!rawEntity || !action) {
      return res.status(400).json({ message: 'Rota ou método inválido.' });
    }

    const entity = resolveEntity(rawEntity);

    const hasPermission = userHasPermission(user.role, entity, action);

    if (!hasPermission) {
      return res.status(400).json({
        error: `Acesso negado: sem permissão de "${translateActions[action]}" em "${ROLE_PERMISSIONS.find(s => s.entity == entity)!.scope}".`,
      });
    }

    req.user = { id: decoded.id, role: decoded.role };

    next();
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError) {
      return res.status(401).json({ message: 'Token inválido.' });
    }

    return res.status(500).json({ message: 'Erro interno no middleware.' });
  }
}