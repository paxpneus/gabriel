/**
 * Re-enqueues for Bling ingestion every order that still has an order_item whose
 * SKU no longer exists in the order's current Bling payload (item swapped/removed
 * before updateOrderFromBling started deleting orphans). The ingestion worker
 * re-fetches the order and removes the orphan item.
 *
 * Uso:
 *   npx ts-node src/scripts/bling/resync-orders-with-orphan-items.ts
 *
 * Env:
 *   DRY_RUN=true → só lista os pedidos, sem enfileirar
 */

import { QueryTypes } from "sequelize";
import sequelize from "../../config/sequelize";
import { setupAssociations } from "../../config/sequelize-associations";
import { getBlingIntegration } from "../../modules/handlers/bling/api/bling_api.service";
import {
  BlingOrderQueue,
  BULK_FORCE_UPDATE_JOB_NAME,
  BULK_FORCE_UPDATE_PRIORITY,
} from "../../modules/handlers/bling/services/bling-orders/bling-order.queue";

const DRY_RUN = process.env.DRY_RUN === "true";
const ENQUEUE_CHUNK_SIZE = 100;

interface OrphanOrderRow {
  id_order_system: string;
  number_order_system: string;
  orphan_skus: string[];
}

// Mesmo critério de órfão do updateOrderFromBling: SKU local sem linha correspondente em itens[].codigo.
async function findOrdersWithOrphanItems(
  integrationId: string,
): Promise<OrphanOrderRow[]> {
  return sequelize.query<OrphanOrderRow>(
    `
    SELECT o.id_order_system,
           o.number_order_system,
           ARRAY_AGG(DISTINCT oi.sku) AS orphan_skus
    FROM orders o
    JOIN order_items oi ON oi.order_id = o.id
    WHERE o.integrations_id = :integrationId
      AND o.id_order_system IS NOT NULL
      AND o.source_payload ? 'itens'
      AND oi.sku IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(o.source_payload->'itens') item
        WHERE item->>'codigo' = oi.sku
      )
    GROUP BY o.id_order_system, o.number_order_system
    ORDER BY o.number_order_system
    `,
    { type: QueryTypes.SELECT, replacements: { integrationId } },
  );
}

async function main() {
  await sequelize.authenticate();
  setupAssociations();

  const integration = await getBlingIntegration();
  const orders = await findOrdersWithOrphanItems(integration.id);

  console.log(`[resync-orphan-items] ${orders.length} orders with orphan items`);
  for (const order of orders) {
    console.log(
      `  order ${order.number_order_system} (bling ${order.id_order_system}) orphan skus: ${order.orphan_skus.join(", ")}`,
    );
  }

  if (DRY_RUN || !orders.length) {
    if (DRY_RUN) console.log("[resync-orphan-items] DRY_RUN — nothing enqueued");
    process.exit(0);
  }

  const queue = new BlingOrderQueue(null as any, null as any, { workless: true });

  // Mesmo guard do botão de force-update em massa: não empilha dois disparos.
  if (await queue.hasPendingJobsNamed([BULK_FORCE_UPDATE_JOB_NAME])) {
    console.error(
      "[resync-orphan-items] a bulk force-update is still pending in BLING_ORDER_INGESTION — aborting",
    );
    process.exit(1);
  }

  for (let start = 0; start < orders.length; start += ENQUEUE_CHUNK_SIZE) {
    const chunk = orders.slice(start, start + ENQUEUE_CHUNK_SIZE);
    await Promise.all(
      chunk.map((order) =>
        queue.add(
          {
            event: "order.updated",
            action: "updated",
            data: { id: Number(order.id_order_system) },
          },
          `bling-order-force-update-${order.id_order_system}`,
          {
            priority: BULK_FORCE_UPDATE_PRIORITY,
            name: BULK_FORCE_UPDATE_JOB_NAME,
          },
        ),
      ),
    );
    console.log(
      `[resync-orphan-items] enqueued ${Math.min(start + ENQUEUE_CHUNK_SIZE, orders.length)}/${orders.length}`,
    );
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("[resync-orphan-items] failed:", error);
  process.exit(1);
});
