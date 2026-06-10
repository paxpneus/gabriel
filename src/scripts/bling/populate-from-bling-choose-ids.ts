/**
 * bling-migration-by-ids.script.ts
 *
 * Migração cirúrgica: escolha a entidade e passe os IDs do Bling que deseja registrar.
 *
 * Uso interativo (menu + prompt de IDs):
 *   npx ts-node bling-migration-by-ids.script.ts
 *
 * Uso via args (não-interativo, ideal para CI/scripts):
 *   npx ts-node bling-migration-by-ids.script.ts --entity products --ids 123,456,789
 *   npx ts-node bling-migration-by-ids.script.ts --entity orders   --ids 111 222 333
 *
 * Opções de ambiente:
 *   DRY_RUN=true   → mostra os jobs sem enfileirar
 *   PAGE_DELAY_MS  → delay entre chamadas à API (default 250ms)
 */

import * as readline from 'readline';
import { v4 as uuidv4 } from 'uuid';
import { blingApi } from '../modules/handlers/bling/api/bling_api.service';
import { ApiFetchJobPayload } from '../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue';
import type { DirectUpsertJobPayload } from '../modules/handlers/bling/services/bling/queues/bling-direct-upsert.queue';
import { BlingDirectUpsertQueue } from '../modules/handlers/bling/services/bling/queues/bling-direct-upsert.queue';
import { BlingApiFetchQueue } from '../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue';
import { BlingOrderQueue } from '../modules/handlers/bling/services/bling-orders/bling-order.queue';
import { UnitBusiness } from '../modules/warehouse';
import { setupAssociations } from '../config/sequelize-associations';
import sequelize from '../config/sequelize';
import {
  BLING_INVOICE_CUTOFF_DATE_PARAM,
  getBlingInvoiceReferenceDate,
  isKnownBlingInvoiceBeforeCutoff,
} from '../modules/handlers/bling/services/bling/bling-invoice-cutoff';

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  await sequelize.authenticate();
  setupAssociations();
}

// ─── Config ───────────────────────────────────────────────────────────────────

const DRY_RUN       = process.env.DRY_RUN === 'true';
const PAGE_DELAY_MS = Number(process.env.PAGE_DELAY_MS ?? 250);

// ─── Filas ────────────────────────────────────────────────────────────────────

const directUpsertQueue = new BlingDirectUpsertQueue({ workless: true });
const apiFetchQueue     = new BlingApiFetchQueue({ workless: true });
const orderQueue        = new BlingOrderQueue(null as any, null as any, { workless: true });

// ─── UnitBusiness map ─────────────────────────────────────────────────────────

type UnitBusinessMap = Record<string, string>;
let unitBusinessMap: UnitBusinessMap = {};

async function loadUnitBusinessMap() {
  const units = await UnitBusiness.findAll({ attributes: ['id', 'id_system'] });
  unitBusinessMap = Object.fromEntries(units.map((u) => [u.id_system, u.id]));
  console.log(`  → ${units.length} UnitBusiness(es) carregado(s)`);
}

function resolveOptionalCompanyId(blingStoreId?: string | number): string | null {
  if (!blingStoreId) return null;
  const id = unitBusinessMap[String(blingStoreId)];
  if (!id) {
    console.warn(`  ⚠️  UnitBusiness não encontrado para loja ${blingStoreId}.`);
    return null;
  }
  return id;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

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
  if (DRY_RUN) { console.log(`  [DRY_RUN] DirectUpsert → ${jobId}`); return; }
  await directUpsertQueue.add(payload, jobId);
}

async function enqueueApiFetch(payload: ApiFetchJobPayload, jobId: string) {
  if (DRY_RUN) { console.log(`  [DRY_RUN] ApiFetch    → ${jobId}`); return; }
  await apiFetchQueue.add(payload, jobId);
}

async function blingGetById<T>(endpoint: string, id: number): Promise<T | null> {
  await sleep(PAGE_DELAY_MS);
  try {
    const { data } = await blingApi.get<{ data: T }>(`${endpoint}/${id}`);
    return data?.data ?? null;
  } catch (err: any) {
    const status = err?.response?.status;
    console.warn(`  ⚠️  GET ${endpoint}/${id} → ${status ?? err.message}`);
    return null;
  }
}

function mapSituacao(situacao?: number): 'OPEN' | 'PENDING' | 'FINISHED' | 'CANCELLED' {
  return situacao === 2 ? 'CANCELLED' : 'OPEN';
}

// ─── Handlers por entidade ────────────────────────────────────────────────────

async function processProducts(ids: number[]) {
  let ok = 0, fail = 0;
  for (const blingId of ids) {
    const product = await blingGetById<{ id: number; nome: string; codigo: string }>('/produtos', blingId);
    if (!product) { fail++; continue; }

    const jobBase = basePayload('product', blingId);
    await enqueueDirectUpsert(
      { ...jobBase, directUpsert: { table: 'products', data: { blingId, name: product.nome ?? '', sku: product.codigo ?? '', ean: `PENDING-${blingId}` } } },
      `migration-product-upsert-${blingId}`,
    );
    await enqueueApiFetch(
      { ...jobBase, apiFetch: { resource: 'product', blingId, action: 'created', companyId: '' } },
      `migration-product-fetch-${blingId}`,
    );
    ok++;
    console.log(`  ✓ Produto ${blingId} — ${product.nome}`);
  }
  return { ok, fail };
}

async function processSuppliers(ids: number[]) {
  let ok = 0, fail = 0;
  for (const blingId of ids) {
    const supplier = await blingGetById<{ id: number; nome: string }>('/contatos', blingId);
    if (!supplier) { fail++; continue; }

    const jobBase = basePayload('supplier', blingId);
    await enqueueDirectUpsert(
      { ...jobBase, directUpsert: { table: 'suppliers', data: { id_system: String(blingId), name: supplier.nome, document: `PENDING-${blingId}`, fantasy_name: null, city: '', uf: '' } } },
      `migration-supplier-upsert-${blingId}`,
    );
    ok++;
    console.log(`  ✓ Fornecedor ${blingId} — ${supplier.nome}`);
  }
  return { ok, fail };
}

async function processSellers(ids: number[]) {
  let ok = 0, fail = 0;
  for (const blingId of ids) {
    const seller = await blingGetById<{ id: number; loja?: { id?: number }; contato?: { nome?: string } }>('/vendedores', blingId);
    if (!seller) { fail++; continue; }

    const unitBusinessId = resolveOptionalCompanyId(seller.loja?.id);
    const jobBase = basePayload('seller', blingId);
    await enqueueDirectUpsert(
      { ...jobBase, directUpsert: { table: 'contacts', data: { id_system: String(blingId), name: seller.contato?.nome ?? '', type: 'SELLER', unit_business_id: unitBusinessId } } },
      `migration-seller-upsert-${blingId}`,
    );
    ok++;
    console.log(`  ✓ Vendedor ${blingId} — ${seller.contato?.nome}`);
  }
  return { ok, fail };
}

async function processProductSuppliers(ids: number[]) {
  let ok = 0, fail = 0;
  for (const blingId of ids) {
    const ps = await blingGetById<{ id: number; codigo?: string; produto: { id: number }; fornecedor: { id: number } }>('/produtos/fornecedores', blingId);
    if (!ps) { fail++; continue; }

    const jobBase = basePayload('product_supplier', blingId);
    await enqueueDirectUpsert(
      { ...jobBase, directUpsert: { table: 'product_supplier_maps', data: { productBlingId: ps.produto.id, supplierBlingId: ps.fornecedor.id, supplier_product_code: ps.codigo ?? '' } } },
      `migration-ps-upsert-${blingId}`,
    );
    await enqueueApiFetch(
      { ...jobBase, apiFetch: { resource: 'product_supplier', blingId, action: 'created', companyId: '' } },
      `migration-ps-fetch-${blingId}`,
    );
    ok++;
    console.log(`  ✓ Produto-Fornecedor ${blingId}`);
  }
  return { ok, fail };
}

async function processStocks(ids: number[]) {
  // ids aqui são IDs de produto Bling
  let ok = 0, fail = 0;
  const BATCH_SIZE = 100;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    const batch = ids.slice(i, i + BATCH_SIZE);
    const params = new URLSearchParams();
    for (const id of batch) params.append('idsProdutos[]', String(id));
    params.append('filtroSaldoEstoque', '1');

    await sleep(PAGE_DELAY_MS);
    try {
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
        ok++;
        console.log(`  ✓ Estoque produto ${blingId} — saldo: ${stock.saldoFisicoTotal}`);
      }
    } catch (err: any) {
      console.warn(`  ⚠️  Erro ao buscar estoques do lote: ${err.message}`);
      fail += batch.length;
    }
  }
  return { ok, fail };
}

async function processOrders(ids: number[]) {
  let ok = 0, fail = 0;
  for (const blingId of ids) {
    try {
      if (DRY_RUN) {
        console.log(`  [DRY_RUN] OrderQueue → migration-order-${blingId}`);
      } else {
        await orderQueue.add({ event: 'order.created', data: { id: blingId } }, `migration-order-${blingId}`);
      }
      ok++;
      console.log(`  ✓ Pedido ${blingId}`);
    } catch (err: any) {
      console.warn(`  ⚠️  Pedido ${blingId} — ${err.message}`);
      fail++;
    }
  }
  return { ok, fail };
}

async function processInvoices(ids: number[], type: 'NF-e' | 'NFC-e') {
  const resource = type === 'NF-e' ? 'invoice' : 'consumer_invoice';
  const endpoint = type === 'NF-e' ? '/nfe' : '/nfce';
  let ok = 0, fail = 0, skipped = 0;

  for (const blingId of ids) {
    const invoice = await blingGetById<{ id: number; situacao?: number; dataEmissao?: string; dataOperacao?: string }>(endpoint, blingId);
    if (!invoice) { fail++; continue; }

    const referenceDate = getBlingInvoiceReferenceDate(invoice);
    if (referenceDate && isKnownBlingInvoiceBeforeCutoff(referenceDate)) {
      console.log(`  ⏭  ${type} ${blingId} — antes do cutoff, ignorada`);
      skipped++;
      continue;
    }

    const jobBase = basePayload(resource, blingId);
    await enqueueApiFetch(
      { ...jobBase, apiFetch: { resource: resource as any, blingId, action: 'created', companyId: '', partialData: { blingId, id_system: String(blingId), status: mapSituacao(invoice.situacao) } } },
      `migration-${resource}-fetch-${blingId}`,
    );
    ok++;
    console.log(`  ✓ ${type} ${blingId} — situação: ${invoice.situacao}`);
  }
  return { ok, fail, skipped };
}

// ─── Definição das entidades disponíveis ──────────────────────────────────────

type EntityKey =
  | 'products'
  | 'suppliers'
  | 'sellers'
  | 'product_suppliers'
  | 'stocks'
  | 'orders'
  | 'nfe'
  | 'nfce';

const ENTITIES: { key: EntityKey; label: string; hint: string }[] = [
  { key: 'products',          label: '📦  Produtos',           hint: 'IDs de produto no Bling' },
  { key: 'suppliers',         label: '🏭  Fornecedores',        hint: 'IDs de contato (tipo fornecedor)' },
  { key: 'sellers',           label: '👤  Vendedores',          hint: 'IDs de vendedor' },
  { key: 'product_suppliers', label: '🔗  Produto-Fornecedor',  hint: 'IDs do vínculo produto-fornecedor' },
  { key: 'stocks',            label: '📊  Estoques',            hint: 'IDs de produto (busca saldo)' },
  { key: 'orders',            label: '🛒  Pedidos',             hint: 'IDs de pedido de venda' },
  { key: 'nfe',               label: '🧾  NF-e',               hint: 'IDs de nota fiscal eletrônica' },
  { key: 'nfce',              label: '🧾  NFC-e',              hint: 'IDs de nota fiscal consumidor' },
];

async function runEntity(entity: EntityKey, ids: number[]) {
  switch (entity) {
    case 'products':         return processProducts(ids);
    case 'suppliers':        return processSuppliers(ids);
    case 'sellers':          return processSellers(ids);
    case 'product_suppliers':return processProductSuppliers(ids);
    case 'stocks':           return processStocks(ids);
    case 'orders':           return processOrders(ids);
    case 'nfe':              return processInvoices(ids, 'NF-e');
    case 'nfce':             return processInvoices(ids, 'NFC-e');
  }
}

// ─── UI interativa ────────────────────────────────────────────────────────────

function renderEntityMenu(cursor: number) {
  const totalLines = ENTITIES.length + 3;
  process.stdout.write(`\x1B[${totalLines}A\x1B[0J`);
  console.log('  Qual entidade deseja migrar?\n');
  ENTITIES.forEach((e, i) => {
    const isCursor = i === cursor;
    const pointer  = isCursor ? '\x1B[36m❯ ' : '  ';
    console.log(`${pointer}${e.label}  \x1B[90m(${e.hint})\x1B[0m`);
  });
  console.log('\n  \x1B[90m↑↓ navegar · ENTER confirmar\x1B[0m');
}

function printInitialEntityMenu() {
  console.log('  Qual entidade deseja migrar?\n');
  ENTITIES.forEach((e) => console.log(`    ${e.label}  \x1B[90m(${e.hint})\x1B[0m`));
  console.log('\n  \x1B[90m↑↓ navegar · ENTER confirmar\x1B[0m');
}

async function selectEntity(): Promise<EntityKey> {
  return new Promise((resolve) => {
    let cursor = 0;
    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    printInitialEntityMenu();

    const handler = (_: any, key: any) => {
      if (!key) return;
      if (key.ctrl && key.name === 'c') { console.log('\n\n  Cancelado.\n'); process.exit(0); }
      if (key.name === 'up')   { cursor = (cursor - 1 + ENTITIES.length) % ENTITIES.length; renderEntityMenu(cursor); return; }
      if (key.name === 'down') { cursor = (cursor + 1) % ENTITIES.length; renderEntityMenu(cursor); return; }
      if (key.name === 'return') {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.removeListener('keypress', handler);
        process.stdin.pause();
        resolve(ENTITIES[cursor].key);
      }
    };
    process.stdin.on('keypress', handler);
  });
}

async function promptIds(hint: string): Promise<number[]> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`\n  ${hint}\n  IDs (separados por vírgula ou espaço): `, (answer) => {
      rl.close();
      const ids = answer
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number)
        .filter((n) => !isNaN(n) && n > 0);
      resolve(ids);
    });
  });
}

// ─── Parse de args CLI ────────────────────────────────────────────────────────

function parseCliArgs(): { entity: EntityKey | null; ids: number[] } {
  const args = process.argv.slice(2);
  const entityIdx = args.indexOf('--entity');
  const idsIdx    = args.indexOf('--ids');

  if (entityIdx === -1) return { entity: null, ids: [] };

  const entity = args[entityIdx + 1] as EntityKey | undefined;
  if (!entity || !ENTITIES.find((e) => e.key === entity)) {
    console.error(`\n  ❌ Entidade inválida: "${entity}"\n  Opções: ${ENTITIES.map((e) => e.key).join(', ')}\n`);
    process.exit(1);
  }

  let rawIds: string[] = [];
  if (idsIdx !== -1) {
    // aceita --ids 1,2,3 ou --ids 1 2 3
    const afterIds = args.slice(idsIdx + 1).filter((a) => !a.startsWith('--'));
    rawIds = afterIds.join(',').split(/[\s,]+/).filter(Boolean);
  }

  const ids = rawIds.map(Number).filter((n) => !isNaN(n) && n > 0);
  return { entity, ids };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n' + '═'.repeat(55));
  console.log('  🎯 Bling Migration — Por IDs Específicos');
  if (DRY_RUN) console.log('  ⚠️  DRY_RUN ativo — nenhum job será enfileirado');
  console.log('═'.repeat(55) + '\n');

  const cli = parseCliArgs();

  // ── Seleção da entidade ──
  let entity: EntityKey;
  if (cli.entity) {
    entity = cli.entity;
    console.log(`  Entidade: ${ENTITIES.find((e) => e.key === entity)!.label}`);
  } else {
    entity = await selectEntity();
  }

  const entityMeta = ENTITIES.find((e) => e.key === entity)!;

  // ── Coleta dos IDs ──
  let ids: number[];
  if (cli.ids.length) {
    ids = cli.ids;
  } else {
    ids = await promptIds(entityMeta.hint);
  }

  if (!ids.length) {
    console.log('\n  Nenhum ID válido informado. Saindo.\n');
    process.exit(0);
  }

  // ── Resumo ──
  console.log('\n' + '─'.repeat(55));
  console.log(`  Entidade : ${entityMeta.label}`);
  console.log(`  IDs      : ${ids.join(', ')}`);
  console.log(`  Total    : ${ids.length} registro(s)`);
  console.log('─'.repeat(55) + '\n');

  // ── Confirmação ──
  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('  Confirmar e iniciar? [s/N] ', (answer) => {
      rl.close();
      if (answer.toLowerCase() !== 's') { console.log('\n  Cancelado.\n'); process.exit(0); }
      resolve();
    });
  });

  console.log('');
  await bootstrap();
  await loadUnitBusinessMap();

  const start = Date.now();

  try {
    const result = await runEntity(entity, ids);
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);

    console.log('\n' + '═'.repeat(55));
    console.log(`  ✅  Concluído em ${elapsed}s`);
    console.log(`  ✓   OK      : ${result.ok}`);
    if (result.fail)    console.log(`  ✗   Falhas  : ${result.fail}`);
    if ('skipped' in result && result.skipped) console.log(`  ⏭   Ignorados: ${result.skipped}`);
    console.log('═'.repeat(55));
  } catch (err: any) {
    console.error('\n❌ Erro:', err.message);
    process.exit(1);
  }

  process.exit(0);
}

main();