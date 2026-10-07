import {
  SalesFactKey,
  SalesProductFactKey,
  SalesReportFilters,
  SalesReportJobResult,
  SalesStateFactKey,
  SalesStatusFactKey,
  SalesStoreFactKey,
} from "./sales-report.types";
import { salesReportRepository } from "./sales-report.repository";
import { chunkArray, uniqueBy } from "./helpers/fact-keys";

const JOB_NAME = "sales_report";
// Lote de pedidos por rodada de snapshots; entre lotes o job renova o heartbeat do lock.
const ORDERS_PER_BATCH = 500;

interface AffectedFactKeys {
  facts: SalesFactKey[];
  state: SalesStateFactKey[];
  store: SalesStoreFactKey[];
  product: SalesProductFactKey[];
  status: SalesStatusFactKey[];
}

const emptyFactKeys = (): AffectedFactKeys => ({
  facts: [],
  state: [],
  store: [],
  product: [],
  status: [],
});

export class SalesReportService {
  async runIncrementalJob(): Promise<SalesReportJobResult> {
    const jobStartTime = new Date();
    const lastProcessedAt = await salesReportRepository.getCheckpoint();

    const acquired = await salesReportRepository.markRunning();
    if (!acquired) {
      throw new Error("Job já está em execução, aguarde.");
    }

    try {
      const orderIds =
        await salesReportRepository.findAffectedOrderIds(lastProcessedAt);

      const affectedKeys = emptyFactKeys();
      for (const batch of chunkArray(orderIds, ORDERS_PER_BATCH)) {
        this.mergeFactKeys(affectedKeys, await this.refreshSnapshots(batch));
        await salesReportRepository.heartbeat();
      }

      await this.refreshFacts(affectedKeys, () =>
        salesReportRepository.heartbeat(),
      );
      const orphanFactsDeleted =
        await salesReportRepository.deleteOrphanFacts();

      await salesReportRepository.markSuccess(jobStartTime, orderIds.length);

      const supplierDiscountRetro =
        await this.reapplySupplierDiscountsRetroactively();

      return {
        jobName: JOB_NAME,
        startedAt: jobStartTime,
        lastProcessedAt,
        ordersProcessed: orderIds.length,
        orphanFactsDeleted,
        supplierDiscountRetro,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await salesReportRepository.markFailed(err);
      throw err;
    }
  }

  // Snapshots + daily facts dos pedidos, sem tocar em checkpoint/status do job.
  private async processOrders(orderIds: string[]): Promise<void> {
    await this.refreshFacts(await this.refreshSnapshots(orderIds));
  }

  // Chaves de antes e depois do upsert: fact de chave que o pedido deixou (data/loja mudou) também é recalculada.
  private async refreshSnapshots(
    orderIds: string[],
  ): Promise<AffectedFactKeys> {
    const previous = await this.findAffectedFactKeys(orderIds);

    await salesReportRepository.upsertSnapshots(orderIds);
    await salesReportRepository.updateSnapshotTotals(orderIds);

    const keys = await this.findAffectedFactKeys(orderIds);
    this.mergeFactKeys(keys, previous);
    return keys;
  }

  private async findAffectedFactKeys(
    orderIds: string[],
  ): Promise<AffectedFactKeys> {
    const [facts, state, store, product, status] = await Promise.all([
      salesReportRepository.findAffectedFactKeys(orderIds),
      salesReportRepository.findAffectedStateFactKeys(orderIds),
      salesReportRepository.findAffectedStoreFactKeys(orderIds),
      salesReportRepository.findAffectedProductFactKeys(orderIds),
      salesReportRepository.findAffectedStatusFactKeys(orderIds),
    ]);
    return { facts, state, store, product, status };
  }

  private mergeFactKeys(
    target: AffectedFactKeys,
    source: AffectedFactKeys,
  ): void {
    target.facts.push(...source.facts);
    target.state.push(...source.state);
    target.store.push(...source.store);
    target.product.push(...source.product);
    target.status.push(...source.status);
  }

  private async refreshFacts(
    keys: AffectedFactKeys,
    afterEachTable: () => Promise<void> = async () => {},
  ): Promise<void> {
    await salesReportRepository.upsertDailySalesFacts(
      uniqueBy(keys.facts, (k) => `${k.fact_date}:${k.unit_business_id}`),
    );
    await afterEachTable();
    await salesReportRepository.upsertDailySalesStateFacts(
      uniqueBy(
        keys.state,
        (k) => `${k.fact_date}:${k.unit_business_id}:${k.destination_uf}`,
      ),
    );
    await afterEachTable();
    await salesReportRepository.upsertDailySalesStoreFacts(
      uniqueBy(
        keys.store,
        (k) => `${k.fact_date}:${k.unit_business_id}:${k.store_id}`,
      ),
    );
    await afterEachTable();
    await salesReportRepository.upsertDailySalesProductFacts(
      uniqueBy(
        keys.product,
        (k) => `${k.fact_date}:${k.unit_business_id}:${k.sku}`,
      ),
    );
    await afterEachTable();
    await salesReportRepository.upsertDailySalesStatusFacts(keys.status);
    await afterEachTable();
  }

  // Reprocessa só estes pedidos, independente do checkpoint do job incremental
  // (que pode já ter avançado além do updated_at deles).
  async refreshOrders(orderIds: string[]): Promise<void> {
    await this.processOrders(orderIds);
  }

  // ------------------------------------------------------------------
  // Reprocessamento retroativo de supplier_discount_rules — roda DEPOIS do
  // fluxo incremental normal (que respeita o checkpoint principal de
  // orders/order_items) e usa seu PRÓPRIO checkpoint, olhando só regras de
  // desconto alteradas desde o último scan. Não refaz upsertSnapshots (a
  // query grande e cara) para os pedidos candidatos — só reaplica o motor de
  // desconto (que já filtra regra ativa e zera quando não há mais match) e
  // atualiza os daily facts apenas para os pedidos cujo desconto realmente
  // mudou. Roda em try/catch isolado: uma falha aqui não deve reverter o
  // sucesso já confirmado do job principal.
  // ------------------------------------------------------------------
  private async reapplySupplierDiscountsRetroactively(): Promise<
    SalesReportJobResult["supplierDiscountRetro"]
  > {
    const scanStartTime = new Date();

    try {
      const since =
        await salesReportRepository.getSupplierDiscountRetroCheckpoint();

      const candidateOrderIds =
        await salesReportRepository.findOrderIdsAffectedBySupplierDiscountRuleChanges(
          since,
        );

      const changedOrderIds = candidateOrderIds.length
        ? await salesReportRepository.reapplySupplierDiscountsForOrderIds(
            candidateOrderIds,
          )
        : [];

      if (changedOrderIds.length) {
        await this.refreshFacts(await this.findAffectedFactKeys(changedOrderIds));
      }

      await salesReportRepository.markSupplierDiscountRetroCheckpointSuccess(
        scanStartTime,
        changedOrderIds.length,
      );

      return {
        candidateOrders: candidateOrderIds.length,
        ordersUpdated: changedOrderIds.length,
      };
    } catch (error) {
      console.error(
        "[SalesReport] Reprocessamento retroativo de supplier_discount_rules falhou:",
        error instanceof Error ? error.message : error,
      );
      return { candidateOrders: 0, ordersUpdated: 0 };
    }
  }

  async getJobStatus() {
    return salesReportRepository.getJobStatus();
  }

  async getReport(filters: SalesReportFilters) {
    if (!filters.dateFrom || !filters.dateTo) {
      throw new Error("dateFrom e dateTo são obrigatórios.");
    }

    return salesReportRepository.getReport(filters);
  }
}

export default new SalesReportService();
