// modules/queues/queues/bling-api-fetch/services/bling-api-fetch.service.ts
import { QueueMonitorService } from "../../../services/queue.service";
import { QueueJobStatus } from "../../../types/queue.types";
import {
  normalizeBlingApiFetchJob,
  NormalizedBlingApiFetchJob,
} from "../../helpers/bling-api-fetch-jobs.normalizer";

const BLING_API_FETCH_QUEUE = "BLING_API_FETCH";

export class BlingApiFetchService extends QueueMonitorService {
  async getJobs(
    name: string = BLING_API_FETCH_QUEUE,
    status: QueueJobStatus = "waiting",
    start = 0,
    end = -1,
  ): Promise<NormalizedBlingApiFetchJob[]> {
    const jobs = await super.getJobs(name, status, start, end);
    return jobs.map(normalizeBlingApiFetchJob);
  }

}

export default new BlingApiFetchService();