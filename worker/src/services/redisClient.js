import Redis from "ioredis";
import { env } from "../config/env.js";

export const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
export const redisSub = new Redis(env.redisUrl);
