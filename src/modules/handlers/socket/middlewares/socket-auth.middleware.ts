import jwt from "jsonwebtoken";
import { Socket } from "socket.io";
import cookie from "cookie";
import "dotenv/config";

interface SocketUserPayload {
  id: string;
  role: string;
  type?: string;
  tokenVersion?: number;
}

function getTokenFromSocket(socket: Socket): string | null {
  const authToken = socket.handshake.auth?.token as string | undefined;
  if (authToken) return authToken;

  const rawCookie = socket.handshake.headers.cookie;
  if (rawCookie) {
    const parsed = cookie.parseCookie(rawCookie);
    if (parsed.token) return parsed.token;
  }

  return null;
}

export function verifySocketToken(token: string): SocketUserPayload | null {
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as SocketUserPayload;
    return payload;
  } catch {
    return null;
  }
}

export function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void
) {
  const token = getTokenFromSocket(socket);

  if (!token) {
    return next(new Error("unauthorized"));
  }

  const payload = verifySocketToken(token);

  if (!payload) {
    return next(new Error("unauthorized"));
  }

  if (payload.type === "application") {
    return next(new Error("unauthorized"));
  }

  socket.data.user = { id: payload.id, role: payload.role };

  next();
}