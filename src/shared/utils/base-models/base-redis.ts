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
    const stringValue = JSON.stringify(value);

    if (!options?.mode) {
      const result = await this.client.set(key, stringValue);
      return this.handleResponse<T>(result);
    }

    const data = await this.client.set(
      key,
      stringValue,
      options.mode as any,
      options.duration || 0,
      (options.condition || "") as any,
      (options.specialMethod || "") as any,
    );

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
