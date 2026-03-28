import { redisClient } from "../../../config/redis";
import Redis from "ioredis";


class RedisService {
    private client: Redis

    constructor(client: Redis) {
        this.client = client
    }


    async get<T>(key: string): Promise<T | null> {
        const data = await this.client.get(JSON.stringify(key));

        if (data == null) return null

        try {
            return JSON.parse(data) as T
        } catch {
            return data as unknown as T
        } 
    }

      async set<T>(key: string, value: unknown): Promise<T | null> {
        const data = await this.client.set(key, JSON.stringify(value));
        
        if (data == null) return null

        try {
            return JSON.parse(data) as T
        } catch {
            return data as unknown as T
        } 
    }

}

export default new RedisService(redisClient);