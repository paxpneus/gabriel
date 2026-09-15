/**
 * bling-orders-situacao-diff.script.ts
 *
 * Pagina os pedidos de venda na Bling e compara `situacao.id` (traduzido via
 * mapOrderInternalStatus) com `orders.actual_situation` no banco.
 *
 * Só enfileira na BlingOrderQueue (ingestão) os pedidos cuja situação
 * estiver DIVERGENTE. Não atualiza nada diretamente — quem atualiza é o
 * worker de ingestão que consome a fila.
 *
 * Uso:
 *   npx ts-node bling-orders-situacao-diff.script.ts
 *   npx ts-node bling-orders-situacao-diff.script.ts --data-inicial 2026-08-01 --data-final 2026-09-15
 *
 * Env:
 *   DRY_RUN=true   → mostra os que seriam enfileirados, sem enfileirar
 *   PAGE_DELAY_MS  → delay entre páginas (default 250ms)
 *   PAGE_SIZE      → tamanho de página na Bling (default 100, máx da API)
 */

import { blingApi } from '../../modules/handlers/bling/api/bling_api.service';
import { BlingOrderQueue } from '../../modules/handlers/bling/services/bling-orders/bling-order.queue';
import { mapOrderInternalStatus } from '../../shared/utils/normalizers/bling/status-mapper';
import { OrderInternalStatus } from '../../modules/sales/orders/order/orders.types';
import { setupAssociations } from '../../config/sequelize-associations';
import sequelize from '../../config/sequelize';
import Order from '../../modules/sales/orders/order/orders.model';

// ─── Config ───────────────────────────────────────────────────────────────────

const DRY_RUN       = process.env.DRY_RUN === 'true';
const PAGE_DELAY_MS = Number(process.env.PAGE_DELAY_MS ?? 250);
const PAGE_SIZE      = Number(process.env.PAGE_SIZE ?? 100);

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ─── Fila ─────────────────────────────────────────────────────────────────────

const orderQueue = new BlingOrderQueue(null as any, null as any, { workless: true });

// ─── Tipos da resposta da Bling ────────────────────────────────────────────────

interface BlingOrderListItem {
  id: number;
  numero: number;
  situacao: { id: number; valor: number };
  loja?: { id?: number };
}

interface BlingOrdersPage {
  data: BlingOrderListItem[];
}

// ─── CLI args ─────────────────────────────────────────────────────────────────

function parseCliArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };
  return {
    dataInicial: get('--data-inicial'), // formato YYYY-MM-DD, opcional
    dataFinal:   get('--data-final'),   // formato YYYY-MM-DD, opcional
  };
}

// ─── Paginação na Bling ─────────────────────────────────────────────────────────

async function fetchOrdersPage(pagina: number, dataInicial?: string, dataFinal?: string): Promise<BlingOrderListItem[]> {
  const params = new URLSearchParams();
  params.append('pagina', String(pagina));
  params.append('limite', String(PAGE_SIZE));
  if (dataInicial) params.append('dataInicial', dataInicial);
  if (dataFinal)   params.append('dataFinal', dataFinal);

  await sleep(PAGE_DELAY_MS);
  const { data } = await blingApi.get<BlingOrdersPage>(`/pedidos/vendas?${params.toString()}`);
  return data?.data ?? [];
}

// ─── Enfileiramento (ingestão) ──────────────────────────────────────────────────

async function enqueueForIngestion(blingId: number) {
  const jobId = `situacao-diff-order-${blingId}`;
  if (DRY_RUN) {
    console.log(`  [DRY_RUN] BlingOrderQueue → ${jobId}`);
    return;
  }
  // TODO: confirmar o formato exato de evento que o worker de ingestão espera
  await orderQueue.add({ event: 'order.updated', data: { id: blingId } }, jobId);
}

// ─── Core: compara e decide se enfileira ────────────────────────────────────────

async function processDivergentOrders(dataInicial?: string, dataFinal?: string) {
  let pagina = 1;
  let totalPages = 0;
  let checked = 0;
  let divergent = 0;
  let notFoundLocally = 0;

  while (true) {
    const items = await fetchOrdersPage(pagina, dataInicial, dataFinal);
    if (!items.length) break;

    totalPages++;
    console.log(`\n  📄 Página ${pagina} — ${items.length} pedido(s)`);

    const blingIds = items.map((i) => i.id);

    // Busca em lote os pedidos locais correspondentes a essa página
    const localOrders = await Order.findAll({
      where: { id_order_system: blingIds.map(String) },
      attributes: ['id', 'id_system', 'actual_situation'],
    });

    const localByBlingId = new Map<string, { actual_situation: string }>(
      localOrders.map((o: any) => [String(o.id_system), o]),
    );

    for (const item of items) {
      checked++;
      const local = localByBlingId.get(String(item.id));

      if (!local) {
        notFoundLocally++;
        console.log(`  ⚠️  Pedido ${item.id} — não encontrado localmente, ignorado`);
        continue;
      }

      const blingStatus = mapOrderInternalStatus(item.situacao.id);
      const localStatus = local.actual_situation as OrderInternalStatus;

      if (blingStatus === localStatus) {
        continue; // sem divergência, não enfileira
      }

      divergent++;
      console.log(
        `  🔀 Pedido ${item.id} — divergente: bling=${item.situacao.id} (${blingStatus}) vs local=${localStatus} → enfileirando`,
      );
      await enqueueForIngestion(item.id);
    }

    pagina++;
  }

  return { totalPages, checked, divergent, notFoundLocally };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(55));
  console.log('  🔀 Bling Orders — Divergência de Situação');
  if (DRY_RUN) console.log('  ⚠️  DRY_RUN ativo — nenhum job será enfileirado');
  console.log('═'.repeat(55) + '\n');

  const { dataInicial, dataFinal } = parseCliArgs();
  if (dataInicial || dataFinal) {
    console.log(`  Filtro de data: ${dataInicial ?? '(sem início)'} → ${dataFinal ?? '(sem fim)'}`);
  }

  await sequelize.authenticate();
  setupAssociations();

  const start = Date.now();
  try {
    const result = await processDivergentOrders(dataInicial, dataFinal);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log('\n' + '═'.repeat(55));
    console.log(`  ✅  Concluído em ${elapsed}s`);
    console.log(`  📄  Páginas          : ${result.totalPages}`);
    console.log(`  🔎  Pedidos checados : ${result.checked}`);
    console.log(`  🔀  Divergentes      : ${result.divergent}`);
    if (result.notFoundLocally) console.log(`  ⚠️  Não encontrados  : ${result.notFoundLocally}`);
    console.log('═'.repeat(55));
  } catch (err: any) {
    console.error('\n❌ Erro:', err.message);
    process.exit(1);
  }

  process.exit(0);
}

main();