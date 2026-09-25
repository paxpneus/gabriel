export const TEMP_FILE_SENTINEL_PREFIX = "temp://";

export function buildTempFileSentinelPath(tempFileId: string): string {
  return `${TEMP_FILE_SENTINEL_PREFIX}${tempFileId}`;
}

export function isTempFileSentinelPath(path?: string | null): boolean {
  return !!path && path.startsWith(TEMP_FILE_SENTINEL_PREFIX);
}

export function extractTempFileId(path: string): string {
  return path.slice(TEMP_FILE_SENTINEL_PREFIX.length);
}

export type UploaderDeleteTarget =
  | { type: "temp-file"; tempFileId: string }
  | { type: "real-path"; path: string };

// Decide, a partir do path atual da entidade, o que o job de delete apaga.
export function resolveDeleteTarget(path: string): UploaderDeleteTarget {
  return isTempFileSentinelPath(path)
    ? { type: "temp-file", tempFileId: extractTempFileId(path) }
    : { type: "real-path", path };
}
