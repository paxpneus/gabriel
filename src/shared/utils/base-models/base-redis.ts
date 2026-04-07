import { redisClient } from "../../../config/redis";
import Redis from "ioredis";

type RedisExpireMode = "EX" | "PX" | "EXAT" | "PXAT" | "KEEPTTL";
type RedisCondition = "NX" | "XX";
type RedisSpecialMethods = "GET";

class RedisService {
  public client: Redis;

  constructor(client: Redis) {
    this.client = client;
  }

  async get<T>(key: string): Promise<T | null> {
    const data = await this.client.get(JSON.stringify(key));

    if (data == null) return null;

    try {
      return JSON.parse(data) as T;
    } catch {
      return data as unknown as T;
    }
  }

 async set<T>(
    key: string,
    value: unknown,
    options?: {
      mode?: RedisExpireMode;
      duration?: number;
      condition?: RedisCondition;
      specialMethod?: RedisSpecialMethods;
    },
  ): Promise<T | null> {
    const stringValue = typeof value === 'string' ? value : JSON.stringify(value);

    // Se não tem opções, faz o set simples
    if (!options) {
      const result = await this.client.set(key, stringValue);
      return this.handleResponse<T>(result);
    }

    // Monta o array de argumentos para o Redis
    const args: [string, string | number, ...any[]] = [key, stringValue];

    if (options.mode) {
      args.push(options.mode);
      if (options.duration !== undefined) {
        args.push(options.duration);
      }
    }

    if (options.condition) {
      args.push(options.condition);
    }

    if (options.specialMethod) {
      args.push(options.specialMethod);
    }

    const data = await this.client.set(...args);

    return this.handleResponse<T>(data);
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  private handleResponse<T>(data: string | null): T | null {
  if (data === null) return null;
  if (data === "OK") return data as unknown as T;

  try {
    return JSON.parse(data) as T;
  } catch {
    return data as unknown as T;
  }
}
}

export const redisService = new RedisService(redisClient);
export const redisConnection = redisClient;
export default redisService;
