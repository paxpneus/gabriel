import { MLExcelRow, MLOrderData } from './mercado-livre.types';
import { redisConnection } from '../../../../shared/utils/base-models/base-redis';
const CACHE_TTL_SECONDS = 60 * 60 * 24;
const CACHE_PREFIX = 'ml:collection_date:';
export class MLOrderService {

  constructor() {}

  async updateCache(rows: MLExcelRow[]): Promise<void>{
    const pipeline = redisConnection.pipeline();

    for (const row of rows) {
      const key = `${CACHE_PREFIX}${row.order_number}`;
      pipeline.set(key, row.collection_date.toISOString(), 'EX', CACHE_TTL_SECONDS)
    }

    await pipeline.exec();

    console.log(`[MLOrderService] Cache Redis atualizado com ${rows.length} pedidos`);

  }

  async getCollectionDate(orderNumber: string): Promise<Date | null> {
    const value = await redisConnection.get(`${CACHE_PREFIX}${orderNumber}`);
    return value ? new Date(value) : null
  }

 
}