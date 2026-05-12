/**
 * bling-migration-interactive.script.ts
 *
 * Script de migração com seleção interativa de etapas — estilo Vite.
 * Use as setas ↑↓ para navegar, ESPAÇO para marcar/desmarcar, ENTER para confirmar.
 *
 * Uso:
 *   npx ts-node bling-migration-interactive.script.ts
 *   DRY_RUN=true npx ts-node bling-migration-interactive.script.ts
 */

import * as readline from 'readline';
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

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  await sequelize.authenticate();
  setupAssociations();
}

// ─── Configuração ─────────────────────────────────────────────────────────────

const DRY_RUN       = process.env.DRY_RUN === 'true';
const DAYS_BACK     = 3;
const PAGE_DELAY_MS = 350;
const MAX_PER_ENTITY = Number(process.env.MAX_PER_ENTITY ?? 0);
const QUEUE_POLL_MS  = 5_000;

const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - DAYS_BACK);
const DATA_INICIAL = cutoffDate.toISOString().split('T')[0];

// ─── Filas ────────────────────────────────────────────────────────────────────

const directUpsertQueue = new BlingDirectUpsertQueue({ workless: true });
const apiFetchQueue     = new BlingApiFetchQueue({ workless: true });

// ─── UnitBusiness map ─────────────────────────────────────────────────────────

type UnitBusinessMap = Record<string, string>;
let unitBusinessMap: UnitBusinessMap = {};

async function loadUnitBusinessMap() {
  const units = await UnitBusiness.findAll({ attributes: ['id', 'id_system'] });
  unitBusinessMap = Object.fromEntries(units.map((u) => [u.id_system, u.id]));
  console.log(`  → ${units.length} UnitBusiness(es) carregado(s)`);
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
    console.log(`  ↻ Jobs pendentes: ${totalPending} — checando em ${QUEUE_POLL_MS / 1000}s...`);
    await sleep(QUEUE_POLL_MS);
  }
  console.log(`  ✅ Filas vazias. Avançando...\n`);
}

// ─── Etapas de migração ───────────────────────────────────────────────────────

async function migrateProducts() {
  console.log('─'.repeat(55));
  console.log('📦  ETAPA — Produtos');
  console.log('─'.repeat(55));

  let count = 0;
  for await (const page of paginateBling<{ id: number; nome: string; codigo: string }>('/produtos')) {
    for (const product of page) {
      const blingId = product.id;
      const jobBase = basePayload('product', blingId);

      await enqueueDirectUpsert(
        { ...jobBase, directUpsert: { table: 'products', data: { blingId, name: product.nome ?? '', sku: product.codigo ?? '', ean: `PENDING-${blingId}` } } },
        `migration-product-upsert-${blingId}`,
      );
      await enqueueApiFetch(
        { ...jobBase, apiFetch: { resource: 'product', blingId, action: 'created', companyId: '' } },
        `migration-product-fetch-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }
    console.log(`  → ${count} produto(s) enfileirado(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  📦 Produtos enfileirados: ${count}`);
  await waitForQueuesToDrain('Produtos');
}

async function migrateSuppliers() {
  console.log('─'.repeat(55));
  console.log('🏭  ETAPA — Fornecedores');
  console.log('─'.repeat(55));

  let count = 0;
  const idsParaFiltrar = [17977550190, 17950521052, 17950116368, 17700189867, 16837235915, 16821258764];

  for await (const page of paginateBling<{ id: number; nome: string }>(
    '/contatos',
    { tipoContato: 1, idsContatos: idsParaFiltrar as any },
  )) {
    for (const supplier of page) {
      const blingId = supplier.id;
      const jobBase = basePayload('supplier', blingId);

      await enqueueDirectUpsert(
        { ...jobBase, directUpsert: { table: 'suppliers', data: { id_system: String(blingId), name: supplier.nome, document: `PENDING-${blingId}`, fantasy_name: null, city: '', uf: '' } } },
        `migration-supplier-upsert-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }
    console.log(`  → ${count} fornecedor(es) enfileirado(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  🏭 Fornecedores enfileirados: ${count}`);
  await waitForQueuesToDrain('Fornecedores');
}

async function migrateProductSuppliers() {
  console.log('─'.repeat(55));
  console.log('🔗  ETAPA — Produto-Fornecedor');
  console.log('─'.repeat(55));

  let count = 0;
  for await (const page of paginateBling<{ id: number; codigo?: string; produto: { id: number }; fornecedor: { id: number } }>('/produtos/fornecedores')) {
    for (const ps of page) {
      const blingId = ps.id;
      const jobBase = basePayload('product_supplier', blingId);

      await enqueueDirectUpsert(
        { ...jobBase, directUpsert: { table: 'product_supplier_maps', data: { productBlingId: ps.produto.id, supplierBlingId: ps.fornecedor.id, supplier_product_code: ps.codigo ?? '' } } },
        `migration-ps-upsert-${blingId}`,
      );
      await enqueueApiFetch(
        { ...jobBase, apiFetch: { resource: 'product_supplier', blingId, action: 'created', companyId: '' } },
        `migration-ps-fetch-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }
    console.log(`  → ${count} mapeamento(s) enfileirado(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  🔗 Produto-Fornecedores enfileirados: ${count}`);
  await waitForQueuesToDrain('Produto-Fornecedor');
}

async function migrateStocks() {
  console.log('─'.repeat(55));
  console.log('📊  ETAPA — Estoques');
  console.log('─'.repeat(55));

  const allBlingIds: number[] = [];
  for await (const page of paginateBling<{ id: number }>('/produtos')) {
    for (const p of page) allBlingIds.push(p.id);
  }

  console.log(`  → ${allBlingIds.length} produto(s) para consulta de estoque`);
  if (!allBlingIds.length) { console.log('  ✅ Nenhum produto — etapa ignorada\n'); return; }

  const BATCH_SIZE = 100;
  let count = 0;

  for (let i = 0; i < allBlingIds.length; i += BATCH_SIZE) {
    const batch = allBlingIds.slice(i, i + BATCH_SIZE);
    const params = new URLSearchParams();
    for (const id of batch) params.append('idsProdutos[]', String(id));
    params.append('filtroSaldoEstoque', '1');

    const { data } = await blingApi.get<{ data: Array<{ produto: { id: number }; saldoFisicoTotal: number }> }>(
      `/estoques/saldos?${params.toString()}`,
    );

    for (const stock of data?.data ?? []) {
      const blingId = stock.produto.id;
      const jobBase = basePayload('stock', blingId);

      await enqueueDirectUpsert(
        { ...jobBase, directUpsert: { table: 'stocks', data: { productBlingId: blingId, quantity: stock.saldoFisicoTotal ?? 0, unit_business_id: 'RESOLVE_NO_WORKER' } } },
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

function mapSituacao(situacao?: number): 'OPEN' | 'PENDING' | 'FINISHED' | 'CANCELLED' {
  switch (situacao) {
    case 3: case 5: return 'CANCELLED';
    default: return 'OPEN';
  }
}

async function migrateInvoices(type: 'NF-e' | 'NFC-e', invoiceDirection: 0 | 1) {
  const resource = type === 'NF-e' ? 'invoice' : 'consumer_invoice';
  const endpoint = type === 'NF-e' ? '/nfe' : '/nfce';
  const label    = `${type} (${invoiceDirection === 1 ? 'Saída' : 'Entrada'})`;

  console.log('─'.repeat(55));
  console.log(`🧾  ETAPA — Notas Fiscais ${label}`);
  console.log('─'.repeat(55));

  let count = 0;
  let skipped = 0;

  for await (const page of paginateBling<{ id: number; numero?: string; situacao?: number; tipo?: number; loja?: { id: number } }>(
    endpoint, { dataInicial: DATA_INICIAL, tipo: invoiceDirection },
  )) {
    for (const invoice of page) {
      const blingId = invoice.id;


      const jobBase = basePayload(resource, blingId);
      await enqueueApiFetch(
        { ...jobBase, apiFetch: { resource: resource as any, blingId, action: 'created', companyId: '', partialData: { blingId, id_system: String(blingId), status: mapSituacao(invoice.situacao) } } },
        `migration-${resource}-fetch-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }
    console.log(`  → ${count} nota(s) enfileirada(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  🧾 ${label} enfileiradas: ${count} | ignoradas: ${skipped}`);
  await waitForQueuesToDrain(`Notas Fiscais ${label}`);
}

// ─── UI interativa estilo Vite ────────────────────────────────────────────────

const STEPS = [
  { key: 'products',          label: '📦  Produtos',                    fn: () => migrateProducts() },
  { key: 'suppliers',         label: '🏭  Fornecedores',                fn: () => migrateSuppliers() },
  { key: 'product_suppliers', label: '🔗  Produto-Fornecedor',          fn: () => migrateProductSuppliers() },
  { key: 'stocks',            label: '📊  Estoques',                    fn: () => migrateStocks() },
  { key: 'nfe_out',           label: '🧾  NF-e Saída  (tipo 1)',        fn: () => migrateInvoices('NF-e', 1) },
  { key: 'nfe_in',            label: '🧾  NF-e Entrada (tipo 0)',       fn: () => migrateInvoices('NF-e', 0) },
  { key: 'nfce',              label: '🧾  NFC-e',                       fn: () => migrateInvoices('NFC-e', 1) },
] as const;

type StepKey = typeof STEPS[number]['key'];

function renderMenu(selected: Set<StepKey>, cursor: number) {
  // Limpa as linhas já impressas (STEPS.length + 3 linhas de instrução)
  const totalLines = STEPS.length + 4;
  process.stdout.write(`\x1B[${totalLines}A\x1B[0J`);

  console.log('  Selecione as etapas para migrar:\n');

  STEPS.forEach((step, i) => {
    const isSelected = selected.has(step.key);
    const isCursor   = i === cursor;

    const checkbox = isSelected ? '◉' : '◯';
    const pointer  = isCursor   ? '❯ ' : '  ';
    const color    = isCursor   ? '\x1B[36m' : '\x1B[0m'; // ciano no cursor

    console.log(`${color}${pointer}${checkbox} ${step.label}\x1B[0m`);
  });

  console.log('\n  \x1B[90mESPAÇO para marcar/desmarcar · ENTER para confirmar · A para tudo\x1B[0m');
}

function printInitialMenu() {
  console.log('  Selecione as etapas para migrar:\n');
  STEPS.forEach((step) => console.log(`  ◯ ${step.label}`));
  console.log('\n  \x1B[90mESPAÇO para marcar/desmarcar · ENTER para confirmar · A para tudo\x1B[0m');
}

async function selectSteps(): Promise<StepKey[]> {
  return new Promise((resolve) => {
    const selected = new Set<StepKey>();
    let cursor = 0;

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    printInitialMenu();

    process.stdin.on('keypress', (_, key) => {
      if (!key) return;

      if (key.name === 'up') {
        cursor = (cursor - 1 + STEPS.length) % STEPS.length;
        renderMenu(selected, cursor);
        return;
      }

      if (key.name === 'down') {
        cursor = (cursor + 1) % STEPS.length;
        renderMenu(selected, cursor);
        return;
      }

      if (key.name === 'space') {
        const k = STEPS[cursor].key;
        if (selected.has(k)) selected.delete(k);
        else selected.add(k);
        renderMenu(selected, cursor);
        return;
      }

      // Tecla A: seleciona/deseleciona tudo
      if (key.name === 'a') {
        if (selected.size === STEPS.length) {
          selected.clear();
        } else {
          STEPS.forEach((s) => selected.add(s.key));
        }
        renderMenu(selected, cursor);
        return;
      }

      if (key.name === 'return') {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(Array.from(selected));
        return;
      }

      // Ctrl+C
      if (key.ctrl && key.name === 'c') {
        console.log('\n\n  Cancelado.\n');
        process.exit(0);
      }
    });
  });
}

// ─── Runner principal ─────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(55));
  console.log('  🚀 Bling Migration — Seleção Interativa');
  console.log(`  📅 Período: últimos ${DAYS_BACK} dias (desde ${DATA_INICIAL})`);
  if (DRY_RUN) console.log('  ⚠️  DRY_RUN ativo — nenhum job será enfileirado');
  console.log('═'.repeat(55) + '\n');

  // Seleção interativa
  const chosen = await selectSteps();

  if (!chosen.length) {
    console.log('\n  Nenhuma etapa selecionada. Saindo.\n');
    process.exit(0);
  }

  // Resumo do que será executado
  console.log('\n' + '─'.repeat(55));
  console.log('  Etapas selecionadas:');
  chosen.forEach((k) => {
    const step = STEPS.find((s) => s.key === k)!;
    console.log(`    ✓ ${step.label}`);
  });
  console.log('─'.repeat(55) + '\n');

  // Confirma antes de rodar
  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('  Confirmar e iniciar? [s/N] ', (answer) => {
      rl.close();
      if (answer.toLowerCase() !== 's') {
        console.log('\n  Cancelado.\n');
        process.exit(0);
      }
      resolve();
    });
  });

  console.log('');

  await bootstrap();
  await loadUnitBusinessMap();

  const start = Date.now();

  // Executa apenas as etapas escolhidas, na ordem original do array STEPS
  // (garante dependências: produtos antes de estoques etc.)
  const orderedChosen = STEPS.filter((s) => chosen.includes(s.key));

  try {
    for (const step of orderedChosen) {
      await step.fn();
    }
  } catch (err: any) {
    console.error('\n❌ Erro durante a migração:', err.message);
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('═'.repeat(55));
  console.log(`  ✅ Migração concluída em ${elapsed}s`);
  console.log('═'.repeat(55));

  process.exit(0);
}

main();