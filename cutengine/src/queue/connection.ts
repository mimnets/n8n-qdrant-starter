import IORedis from 'ioredis';
import { config } from '../config/index.js';

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(config.redis.url, { maxRetriesPerRequest: null });
  }
  return connection;
}
