// middlewares/auth.ts
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import 'dotenv/config'

interface AuthRequest extends Request {
  user?: {
    id: string;
    role: string;
  };
}

export function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token não fornecido' });
  }

  const token = header.split(' ')[1];

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { id: string, role: string };
    req.user = payload; 
    next();
  } catch {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
}