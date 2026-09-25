import { redisConnection } from "../../../shared/utils/base-models/base-redis";
import { TempFileEntityType } from "../../../shared/constants/temp-file-entity-type";

const CACHE_TTL_SECONDS = 24 * 3600; // 1 dia — deslizante, ver getCachedImage
const key = (cacheKey: string) => `uploader-image-cache:${cacheKey}`;

export async function getCachedImage(
  cacheKey: string,
): Promise<{ buffer: Buffer; extension: string } | null> {
  const raw = await redisConnection.get(key(cacheKey));
  if (!raw) return null;

  // TTL deslizante: todo hit renova por mais 24h (ver .claude/modules/uploader-queue.md).
  await redisConnection.expire(key(cacheKey), CACHE_TTL_SECONDS);

  const parsed = JSON.parse(raw) as { extension: string; data: string };
  return { buffer: Buffer.from(parsed.data, "base64"), extension: parsed.extension };
}

export async function setCachedImage(
  cacheKey: string,
  buffer: Buffer,
  extension: string,
): Promise<void> {
  await redisConnection.set(
    key(cacheKey),
    JSON.stringify({ extension, data: buffer.toString("base64") }),
    "EX",
    CACHE_TTL_SECONDS,
  );
}

export async function invalidateCachedImage(cacheKey: string): Promise<void> {
  await redisConnection.del(key(cacheKey));
}

// Chave estável por ENTIDADE, não por path (ver .claude/modules/uploader-queue.md).
export function buildEntityCacheKey(
  entityType: TempFileEntityType,
  entityId: string,
): string {
  return `${entityType}:${entityId}`;
}
