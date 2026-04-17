/**
 * bling-migration-from-stocks.script.ts
 *
 * Script de migração parcial: inicia a partir de Estoques, pulando
 * Produtos, Fornecedores e Produto-Fornecedor (já migrados anteriormente).
 *
 * ⚠️  ORDEM GARANTIDA — cada etapa espera as filas esvaziarem antes de avançar:
 *   4. Estoques            (DirectUpsert)  — presume produtos já no banco
 *   5. Notas Fiscais NF-e  (ApiFetch)
 *   6. Notas Fiscais NFC-e (ApiFetch)
 *
 * Uso:
 *   npx ts-node bling-migration-from-stocks.script.ts
 *   DRY_RUN=true npx ts-node bling-migration-from-stocks.script.ts
 */

import { v4 as uuidv4 } from 'uuid';
import { Queue } from 'bullmq';
import { blingApi } from '../modules/handlers/bling/api/bling_api.service';
import { ApiFetchJobPayload } from '../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue';
import type { DirectUpsertJobPayload } from '../modules/handlers/bling/services/bling/queues/bling-direct-upsert.queue';
import { BlingDirectUpsertQueue } from '../modules/handlers/bling/services/bling/queues/bling-direct-upsert.queue';
import { BlingApiFetchQueue } from '../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue';
import { UnitBusiness } from '../modules/warehouse';
import { setupAssociations } from '../config/sequelize-associations';
import sequelize from '../config/sequelize';

// ─── Bootstrap do banco ───────────────────────────────────────────────────────

async function bootstrap() {
  await sequelize.authenticate();
  setupAssociations();
}

// ─── Configuração ─────────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN === 'true';

/** Quantos dias atrás buscar notas fiscais */
const DAYS_BACK = 30;

/** Pausa entre páginas para respeitar o rate limit da Bling (ms) */
const PAGE_DELAY_MS = 350; // ~3 req/s

/** Limite máximo de registros por entidade (0 = sem limite) */
const MAX_PER_ENTITY = Number(process.env.MAX_PER_ENTITY ?? 0);

/**
 * Intervalo de polling para verificar se as filas esvaziaram (ms).
 * Aumentar se o Redis estiver sobrecarregado.
 */
const QUEUE_POLL_MS = 5_000;

// ─── Data de corte ────────────────────────────────────────────────────────────

const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - DAYS_BACK);
const DATA_INICIAL = cutoffDate.toISOString().split('T')[0]; // YYYY-MM-DD

// ─── Instâncias das filas (workless = só enfileira, não processa aqui) ────────

const directUpsertQueue = new BlingDirectUpsertQueue({ workless: true });
const apiFetchQueue     = new BlingApiFetchQueue({ workless: true });

// ─── Mapa loja Bling → UnitBusiness UUID ──────────────────────────────────────

type UnitBusinessMap = Record<string, string>;
let unitBusinessMap: UnitBusinessMap = {};

async function loadUnitBusinessMap() {
  const units = await UnitBusiness.findAll({ attributes: ['id', 'id_system'] });
  unitBusinessMap = Object.fromEntries(units.map((u) => [u.id_system, u.id]));
  console.log(`  → ${units.length} UnitBusiness(es) carregado(s)`);
}

function resolveCompanyId(blingStoreId?: string | number): string {
  if (!blingStoreId) throw new Error('Bling store id não informado');
  const companyId = unitBusinessMap[String(blingStoreId)];
  if (!companyId) throw new Error(`UnitBusiness não encontrado para loja ${blingStoreId}`);
  return companyId;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function makeEventId(resource: string, id: number | string) {
  return `migration-${resource}-${id}-${uuidv4()}`;
}

function basePayload(resource: string, blingId: number, companyId = '') {
  return {
    eventId:   makeEventId(resource, blingId),
    resource:  resource as any,
    action:    'created' as const,
    companyId,
    date:      new Date().toISOString(),
    rawData:   {},
  };
}

async function enqueueDirectUpsert(payload: DirectUpsertJobPayload, jobId: string) {
  if (DRY_RUN) { console.log(`[DRY_RUN] DirectUpsert: ${jobId}`); return; }
  await directUpsertQueue.add(payload, jobId);
}

async function enqueueApiFetch(payload: ApiFetchJobPayload, jobId: string) {
  if (DRY_RUN) { console.log(`[DRY_RUN] ApiFetch: ${jobId}`); return; }
  await apiFetchQueue.add(payload, jobId);
}

/**
 * Itera todas as páginas de um endpoint paginado da Bling.
 * Bling usa `pagina` (base 1) e `limite` (máx 100).
 */
async function* paginateBling<T>(
  endpoint: string,
  params: Record<string, string | number> = {},
  limitPerPage = 100,
): AsyncGenerator<T[]> {
  let page = 1;

  while (true) {
    const { data } = await blingApi.get<{ data: T[] }>(endpoint, {
      params: { ...params, pagina: page, limite: limitPerPage },
    });

    const items: T[] = data?.data ?? [];
    if (!items.length) break;

    yield items;

    if (items.length < limitPerPage) break;
    page++;
    await sleep(PAGE_DELAY_MS);
  }
}

// ─── Aguardar filas esvaziarem ────────────────────────────────────────────────

async function waitForQueuesToDrain(label: string) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] Pulando espera de fila após: ${label}`);
    return;
  }

  console.log(`\n⏳ Aguardando filas esvaziarem após "${label}"...`);

  const queues: Queue[] = [
    (directUpsertQueue as any).queue,
    (apiFetchQueue as any).queue,
  ];

  while (true) {
    const counts = await Promise.all(
      queues.map((q) => q.getJobCounts('active', 'waiting', 'delayed')),
    );

    const totalPending = counts.reduce(
      (sum, c) => sum + (c.active ?? 0) + (c.waiting ?? 0) + (c.delayed ?? 0),
      0,
    );

    if (totalPending === 0) break;

    console.log(`  ↻ Jobs pendentes: ${totalPending} — checando novamente em ${QUEUE_POLL_MS / 1000}s...`);
    await sleep(QUEUE_POLL_MS);
  }

  console.log(`  ✅ Filas vazias. Avançando...\n`);
}

// ─── 4. Estoques ──────────────────────────────────────────────────────────────

async function migrateStocks() {
  console.log('─'.repeat(55));
  console.log('📊  ETAPA 4 — Estoques');
  console.log('─'.repeat(55));

  // Coleta todos os blingIds de produtos existentes
  const allBlingIds: number[] = [];

  for await (const page of paginateBling<{ id: number }>('/produtos')) {
    for (const p of page) allBlingIds.push(p.id);
  }

  console.log(`  → ${allBlingIds.length} produto(s) para consulta de estoque`);

  if (!allBlingIds.length) {
    console.log('  ✅ Nenhum produto — etapa ignorada\n');
    return;
  }

  const BATCH_SIZE = 100;
  let count = 0;

  for (let i = 0; i < allBlingIds.length; i += BATCH_SIZE) {
    const batch = allBlingIds.slice(i, i + BATCH_SIZE);

    const params = new URLSearchParams();
    for (const id of batch) params.append('idsProdutos[]', String(id));
    params.append('filtroSaldoEstoque', '1');

    const { data } = await blingApi.get<{
      data: Array<{
        produto: { id: number };
        saldoFisicoTotal: number;
      }>;
    }>(`/estoques/saldos?${params.toString()}`);

    const saldos = data?.data ?? [];

    for (const stock of saldos) {
      const blingId = stock.produto.id;
      const jobBase = basePayload('stock', blingId);

      await enqueueDirectUpsert(
        {
          ...jobBase,
          directUpsert: {
            table: 'stocks',
            data: {
              productBlingId: blingId,
              quantity:       stock.saldoFisicoTotal ?? 0,
            },
          },
        },
        `migration-stock-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }

    console.log(`  → ${count} estoque(s) enfileirado(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;

    await sleep(PAGE_DELAY_MS);
  }

  console.log(`\n  📊 Estoques enfileirados: ${count}`);

  await waitForQueuesToDrain('Estoques');
}

// ─── 5 & 6. Notas Fiscais ─────────────────────────────────────────────────────

function mapSituacao(situacao?: number): 'OPEN' | 'PENDING' | 'FINISHED' | 'CANCELLED' {
  switch (situacao) {
    case 3:
    case 5:
      return 'CANCELLED';
    default:
      return 'OPEN';
  }
}

async function migrateInvoices(type: 'NF-e' | 'NFC-e') {
  const resource = type === 'NF-e' ? 'invoice' : 'consumer_invoice';
  const endpoint = type === 'NF-e' ? '/nfe' : '/nfce';
  const etapa    = type === 'NF-e' ? 5 : 6;
  const icon     = '🧾';

  console.log('─'.repeat(55));
  console.log(`${icon}  ETAPA ${etapa} — Notas Fiscais ${type}`);
  console.log('─'.repeat(55));

  let count = 0;
  let skipped = 0;

  for await (const page of paginateBling<{
    id: number;
    numero?: string;
    situacao?: number;
    tipo?: number;
    loja?: { id: number };
  }>(endpoint, { dataInicial: DATA_INICIAL })) {
    for (const invoice of page) {
      const blingId = invoice.id;

      if (!invoice.loja?.id) {
        console.warn(`  ⚠️  Invoice ${blingId} sem loja — ignorada`);
        skipped++;
        continue;
      }

      let companyId: string;
      try {
        companyId = resolveCompanyId(invoice.loja.id);
      } catch (e: any) {
        console.warn(`  ⚠️  ${e.message} — invoice ${blingId} ignorada`);
        skipped++;
        continue;
      }

      const jobBase = basePayload(resource, blingId, companyId);

      await enqueueApiFetch(
        {
          ...jobBase,
          apiFetch: {
            resource:    resource as any,
            blingId,
            action:      'created',
            companyId,
            partialData: {
              blingId,
              id_system: String(blingId),
              status:    mapSituacao(invoice.situacao),
              type:      'OUTGOING',
            },
          },
        },
        `migration-${resource}-fetch-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }

    console.log(`  → ${count} nota(s) enfileirada(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  ${icon} ${type} enfileiradas: ${count} | ignoradas: ${skipped}`);

  await waitForQueuesToDrain(`Notas Fiscais ${type}`);
}

// ─── Runner principal ─────────────────────────────────────────────────────────

async function main() {
  console.log('═'.repeat(55));
  console.log('  🚀 Bling → Filas — Migração Parcial (a partir de Estoques)');
  console.log(`  📅 NF período: últimos ${DAYS_BACK} dias (desde ${DATA_INICIAL})`);
  console.log('  ⏩ Etapas ignoradas: Produtos, Fornecedores, Produto-Fornecedor');
  console.log('═'.repeat(55));

  if (DRY_RUN) {
    console.log('⚠️  MODO DRY_RUN ativo — nenhum job será enfileirado.\n');
  }

  await bootstrap();
  await loadUnitBusinessMap();

  const start = Date.now();

  try {
    // await migrateStocks();            // 4 — presume produtos já no banco
    await migrateInvoices('NF-e');    // 5 — depende de UnitBusiness
    await migrateInvoices('NFC-e');   // 6 — depende de UnitBusiness
  } catch (err: any) {
    console.error('\n❌ Erro durante a migração:', err.message);
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('═'.repeat(55));
  console.log(`  ✅ Migração parcial concluída em ${elapsed}s`);
  console.log('═'.repeat(55));

  process.exit(0);
}

main();