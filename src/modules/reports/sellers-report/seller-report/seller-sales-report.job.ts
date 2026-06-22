import { sellerSalesReportRepository } from "./seller-sales-report.repository";

/**
 * Job incremental do relatório de vendedores.
 * Mesmo padrão do daily_operation_report:
 *   1. Lê checkpoint (último processamento bem-sucedido)
 *   2. Descobre orders afetados desde o checkpoint
 *   3. Recalcula os snapshots (sales_order_item_snapshots) desses orders
 *   4. Recalcula os facts diários (seller+product e seller+customer)
 *   5. Atualiza o checkpoint
 */
export async function runSellerSalesReportJob(): Promise<void> {
  const jobStartTime = new Date();

  try {
    await sellerSalesReportRepository.markRunning();

    const lastProcessedAt = await sellerSalesReportRepository.getCheckpoint();

    const orderIds =
      await sellerSalesReportRepository.findAffectedOrderIds(lastProcessedAt);

    if (!orderIds.length) {
      await sellerSalesReportRepository.markSuccess(jobStartTime, 0);
      return;
    }

    await sellerSalesReportRepository.upsertSnapshots(orderIds);

    const productKeys =
      await sellerSalesReportRepository.findAffectedSellerProductFactKeys(
        orderIds,
      );
    await sellerSalesReportRepository.upsertDailySellerProductFacts(
      productKeys,
    );

    const customerKeys =
      await sellerSalesReportRepository.findAffectedSellerCustomerFactKeys(
        orderIds,
      );
    await sellerSalesReportRepository.upsertDailySellerCustomerFacts(
      customerKeys,
    );

    await sellerSalesReportRepository.markSuccess(
      jobStartTime,
      orderIds.length,
    );
  } catch (error) {
    await sellerSalesReportRepository.markFailed(error as Error);
    throw error;
  }
}