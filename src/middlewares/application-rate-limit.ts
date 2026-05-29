import { Request, Response, NextFunction } from "express";
import redisService from "../shared/utils/base-models/base-redis";
import { AuthRequest } from "./auth-token";

const BAN_DURATIONS_SECONDS = [30, 30 * 60, 60 * 60];
const STRIKE_WINDOW_SECONDS = 60 * 60;

function getClientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

async function banIp(ip: string): Promise<number> {
  const strikeKey = `application-rate:strikes:${ip}`;
  const strikes = await redisService.client.incr(strikeKey);

  if (strikes === 1) {
    await redisService.client.expire(strikeKey, STRIKE_WINDOW_SECONDS);
  }

  const duration =
    BAN_DURATIONS_SECONDS[Math.min(strikes - 1, BAN_DURATIONS_SECONDS.length - 1)];

  await redisService.set(`application-rate:ban:${ip}`, { strikes }, {
    mode: "EX",
    duration,
  });

  return duration;
}

export async function applicationRateLimit(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    const result = await enforceApplicationRateLimit(req);
    if (!result.allowed) return res.status(429).json(result.body);

    return next();
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}

export async function enforceApplicationRateLimit(req: AuthRequest): Promise<
  | { allowed: true }
  | { allowed: false; body: { error: string; retry_after_seconds: number } }
> {
  if (!req.application) return { allowed: true };

  const ip = getClientIp(req);
  const banKey = `application-rate:ban:${ip}`;
  const banned = await redisService.get(banKey);
  if (banned) {
    const ttl = await redisService.client.ttl(banKey);
    return {
      allowed: false,
      body: {
        error: "IP temporariamente bloqueado por excesso de requisições.",
        retry_after_seconds: ttl,
      },
    };
  }

  const maxRequests = req.application.rate_limit_max_requests;
  const windowSeconds = req.application.rate_limit_window_seconds;
  const rateKey = `application-rate:usage:${req.application.id}:${ip}`;
  const count = await redisService.client.incr(rateKey);

  if (count === 1) {
    await redisService.client.expire(rateKey, windowSeconds);
  }

  if (count > maxRequests) {
    const duration = await banIp(ip);
    return {
      allowed: false,
      body: {
        error: "Limite de requisições excedido.",
        retry_after_seconds: duration,
      },
    };
  }

  return { allowed: true };
}
