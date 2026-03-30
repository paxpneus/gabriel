import Redis from "ioredis";
import dotenv from 'dotenv'

dotenv.config()

export const redisConfig = {
    port: Number(process.env.REDIS_PORT),
    host: process.env.REDIS_HOST,
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD,
    db: Number(process.env.REDIS_DB),
    maxRetriesPerRequest: null
};

const redisClient = new Redis(redisConfig);
export { redisClient }