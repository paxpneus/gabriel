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

const JOB_NAME = "sales_report";

export class SalesReportService {
  async runIncrementalJob(): Promise<SalesReportJobResult> {
    const status = await salesReportRepository.getJobStatus();
    if (status?.status === "running") {
      throw new Error("Job já está em execução, aguarde.");
    }

    const jobStartTime = new Date();
    const lastProcessedAt = await salesReportRepository.getCheckpoint();

    try {
      await salesReportRepository.markRunning();

      const orderIds =
        await salesReportRepository.findAffectedOrderIds(lastProcessedAt);

      const previousFactKeys =
        await salesReportRepository.findAffectedFactKeys(orderIds);
      const previousStateFactKeys =
        await salesReportRepository.findAffectedStateFactKeys(orderIds);
      const previousStoreFactKeys =
        await salesReportRepository.findAffectedStoreFactKeys(orderIds);
      const previousProductFactKeys =
        await salesReportRepository.findAffectedProductFactKeys(orderIds);
      const previousStatusFactKeys =
        await salesReportRepository.findAffectedStatusFactKeys(orderIds);

      await salesReportRepository.upsertSnapshots(orderIds);
      await salesReportRepository.updateSnapshotTotals(orderIds);

      const currentFactKeys =
        await salesReportRepository.findAffectedFactKeys(orderIds);
      const currentStateFactKeys =
        await salesReportRepository.findAffectedStateFactKeys(orderIds);
      const currentStoreFactKeys =
        await salesReportRepository.findAffectedStoreFactKeys(orderIds);
      const currentProductFactKeys =
        await salesReportRepository.findAffectedProductFactKeys(orderIds);
      const currentStatusFactKeys =
        await salesReportRepository.findAffectedStatusFactKeys(orderIds);

      await salesReportRepository.upsertDailySalesFacts(
        this.uniqueFactKeys([...previousFactKeys, ...currentFactKeys]),
      );
      await salesReportRepository.upsertDailySalesStateFacts(
        this.uniqueStateFactKeys([
          ...previousStateFactKeys,
          ...currentStateFactKeys,
        ]),
      );
      await salesReportRepository.upsertDailySalesStoreFacts(
        this.uniqueStoreFactKeys([
          ...previousStoreFactKeys,
          ...currentStoreFactKeys,
        ]),
      );
      await salesReportRepository.upsertDailySalesProductFacts(
        this.uniqueProductFactKeys([
          ...previousProductFactKeys,
          ...currentProductFactKeys,
        ]),
      );
      await salesReportRepository.upsertDailySalesStatusFacts(
        this.uniqueStatusFactKeys([
          ...previousStatusFactKeys,
          ...currentStatusFactKeys,
        ]),
      );

      await salesReportRepository.markSuccess(jobStartTime, orderIds.length);

      const supplierDiscountRetro =
        await this.reapplySupplierDiscountsRetroactively();

      return {
        jobName: JOB_NAME,
        startedAt: jobStartTime,
        lastProcessedAt,
        ordersProcessed: orderIds.length,
        supplierDiscountRetro,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await salesReportRepository.markFailed(err);
      throw err;
    }
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
        const [
          factKeys,
          stateFactKeys,
          storeFactKeys,
          productFactKeys,
          statusFactKeys,
        ] = await Promise.all([
          salesReportRepository.findAffectedFactKeys(changedOrderIds),
          salesReportRepository.findAffectedStateFactKeys(changedOrderIds),
          salesReportRepository.findAffectedStoreFactKeys(changedOrderIds),
          salesReportRepository.findAffectedProductFactKeys(changedOrderIds),
          salesReportRepository.findAffectedStatusFactKeys(changedOrderIds),
        ]);

        await salesReportRepository.upsertDailySalesFacts(
          this.uniqueFactKeys(factKeys),
        );
        await salesReportRepository.upsertDailySalesStateFacts(
          this.uniqueStateFactKeys(stateFactKeys),
        );
        await salesReportRepository.upsertDailySalesStoreFacts(
          this.uniqueStoreFactKeys(storeFactKeys),
        );
        await salesReportRepository.upsertDailySalesProductFacts(
          this.uniqueProductFactKeys(productFactKeys),
        );
        await salesReportRepository.upsertDailySalesStatusFacts(
          this.uniqueStatusFactKeys(statusFactKeys),
        );
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

  private uniqueFactKeys(keys: SalesFactKey[]): SalesFactKey[] {
    return Array.from(
      new Map(
        keys.map((key) => [`${key.fact_date}:${key.unit_business_id}`, key]),
      ).values(),
    );
  }

  private uniqueStateFactKeys(keys: SalesStateFactKey[]): SalesStateFactKey[] {
    return Array.from(
      new Map(
        keys.map((key) => [
          `${key.fact_date}:${key.unit_business_id}:${key.destination_uf}`,
          key,
        ]),
      ).values(),
    );
  }

  private uniqueStoreFactKeys(keys: SalesStoreFactKey[]): SalesStoreFactKey[] {
    return Array.from(
      new Map(
        keys.map((key) => [
          `${key.fact_date}:${key.unit_business_id}:${key.store_id}`,
          key,
        ]),
      ).values(),
    );
  }

  private uniqueProductFactKeys(
    keys: SalesProductFactKey[],
  ): SalesProductFactKey[] {
    return Array.from(
      new Map(
        keys.map((key) => [
          `${key.fact_date}:${key.unit_business_id}:${key.sku}`,
          key,
        ]),
      ).values(),
    );
  }

  private uniqueStatusFactKeys(
    keys: SalesStatusFactKey[],
  ): SalesStatusFactKey[] {
    return Array.from(
      new Map(
        keys.map((key) => [
          `${key.fact_date}:${key.unit_business_id}:${key.status_id}`,
          key,
        ]),
      ).values(),
    );
  }
}

export default new SalesReportService();
