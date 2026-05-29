import { baseQueueOptions } from "../../../../../../shared/utils/base-models/base-queue-service";

export const BLING_SHARED_QUEUE_LOCK: NonNullable<
  baseQueueOptions["sharedLock"]
> = {
  key: "locks:bling:queues",
  ttlMs: 15 * 60 * 1000,
  retryDelayMs: 1000,
};
