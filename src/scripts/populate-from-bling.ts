/**
 * bling-migration.script.ts
 *
 * Script de migração inicial: busca todos os dados da Bling e enfileira
 * nas filas existentes (BlingDirectUpsertQueue e BlingApiFetchQueue),
 * respeitando o rate limit da API Bling (3 req/s).
 *
 * Recursos migrados (todos filtrados pelos últimos 30 dias):
 *   1. Produtos
 *   2. Fornecedores (Contatos com tipo fornecedor)
 *   3. Produto-Fornecedor (mapeamentos)
 *   4. Estoques
 *   5. Transportadoras
 *   6. Notas Fiscais NF-e
 *   7. Notas Fiscais NFC-e
 *
 * Uso:
 *   npx ts-node bling-migration.script.ts
 *   # ou com variáveis de ambiente customizadas:
 *   DRY_RUN=true npx ts-node bling-migration.script.ts
 */

import { v4 as uuidv4 } from 'uuid';
import { blingApi } from '../modules/handlers/bling/api/bling_api.service';
import { ApiFetchJobPayload } from '../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue';
import type { DirectUpsertJobPayload } from '../modules/handlers/bling/services/bling/queues/bling-direct-upsert.queue';
import { BlingDirectUpsertQueue } from '../modules/handlers/bling/services/bling/queues/bling-direct-upsert.queue';
import { BlingApiFetchQueue } from '../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue';
import { UnitBusiness } from '../modules/warehouse';

// ─── Configuração ─────────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN === 'true';

/** Quantos dias atrás buscar TODOS os recursos */
const DAYS_BACK = 30;

/** Pausa entre páginas para respeitar o rate limit da Bling (ms) */
const PAGE_DELAY_MS = 3000;

// ─── Data de corte (reutilizada por todos os recursos) ───────────────────────

const cutoffDate = new Date();
cutoffDate.setDate(cutoffDate.getDate() - DAYS_BACK);

/** "YYYY-MM-DD" — formato aceito pela Bling v3 */
const DATA_INICIAL = cutoffDate.toISOString().split('T')[0];

console.log(`📅 Filtrando recursos a partir de: ${DATA_INICIAL}`);

// ─── Mapa de UnitBusiness ────────────────────────────────────────────────────

type UnitBusinessMap = Record<string, string>;
// id_system -> unit_business.id

let unitBusinessMap: UnitBusinessMap = {};

async function loadUnitBusinessMap() {
  const units = await UnitBusiness.findAll({
    attributes: ['id', 'id_system'],
  });

  unitBusinessMap = Object.fromEntries(
    units.map((u) => [u.id_system, u.id]),
  );
}

// ─── Instâncias das filas ─────────────────────────────────────────────────────

// workless=true → as filas apenas enfileiram, sem processar localmente
const directUpsertQueue = new BlingDirectUpsertQueue({ workless: true });
const apiFetchQueue = new BlingApiFetchQueue({ workless: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Itera todas as páginas de um endpoint paginado da Bling.
 * A Bling usa `pagina` (base 1) e `limite` (máx 100).
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

    if (items.length < limitPerPage) break; // última página
    page++;
    await sleep(PAGE_DELAY_MS);
  }
}

function makeEventId(resource: string, id: number | string) {
  return `migration-${resource}-${id}-${uuidv4()}`;
}

function resolveCompanyId(blingStoreId?: string | number): string {
  if (!blingStoreId) {
    throw new Error('Bling store id não informado');
  }

  const companyId = unitBusinessMap[String(blingStoreId)];

  if (!companyId) {
    throw new Error(`UnitBusiness não encontrado para loja ${blingStoreId}`);
  }

  return companyId;
}

function basePayload(resource: string, blingId: number, companyId?: string) {
  return {
    eventId: makeEventId(resource, blingId),
    resource: resource as any,
    action: 'created' as const,
    companyId: companyId ?? '',
    date: new Date().toISOString(),
    rawData: {},
  };
}

async function enqueueDirectUpsert(
  payload: DirectUpsertJobPayload,
  jobId: string,
) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] DirectUpsert: ${jobId}`);
    return;
  }
  await directUpsertQueue.add(payload, jobId);
}

async function enqueueApiFetch(
  payload: ApiFetchJobPayload,
  jobId: string,
) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] ApiFetch: ${jobId}`);
    return;
  }
  await apiFetchQueue.add(payload, jobId);
}

// ─── 1. Produtos ──────────────────────────────────────────────────────────────

async function migrateProducts() {
  console.log('\n📦 Migrando produtos...');
  let count = 0;

  // dataAlteracaoInicial filtra produtos criados/alterados desde a data de corte
  for await (const page of paginateBling<{ id: number; nome: string; codigo: string }>(
    '/produtos',
    { dataAlteracaoInicial: DATA_INICIAL },
  )) {
    for (const product of page) {
      const blingId = product.id;
      const jobBase = basePayload('product', blingId);

      // 1a) DirectUpsert: cria o produto com placeholder de EAN
      await enqueueDirectUpsert(
        {
          ...jobBase,
          directUpsert: {
            table: 'products',
            data: {
              blingId,
              name: product.nome ?? '',
              sku: product.codigo ?? '',
              ean: `PENDING-${blingId}`,
            },
          },
        },
        `migration-product-upsert-${blingId}`,
      );

      // 1b) ApiFetch: complementa com EAN real
      await enqueueApiFetch(
        {
          ...jobBase,
          apiFetch: {
            resource: 'product',
            blingId,
            action: 'created',
            companyId: '',
          },
        },
        `migration-product-fetch-${blingId}`,
      );

      count++;
    }

    console.log(`  → ${count} produtos enfileirados até agora...`);
  }

  console.log(`✅ Produtos: ${count} total`);
}

// ─── 2. Fornecedores (Contatos tipo Fornecedor) ───────────────────────────────

async function migrateSuppliers() {
  console.log('\n🏭 Migrando fornecedores...');
  let count = 0;

  // dataAlteracaoInicial filtra contatos criados/alterados desde a data de corte
  for await (const page of paginateBling<{
    id: number;
    nome: string;
    numeroDocumento?: string;
    fantasia?: string;
    endereco?: { municipio?: string; uf?: string };
    codigo?: string;
  }>('/contatos', { tipoContato: 1, dataAlteracaoInicial: DATA_INICIAL })) {
    for (const supplier of page) {
      const blingId = supplier.id;
      const jobBase = basePayload('product_supplier', blingId);

      await enqueueApiFetch(
        {
          ...jobBase,
          apiFetch: {
            resource: 'product_supplier' as any,
            blingId,
            action: 'created',
            companyId: '',
            partialData: { supplierOnly: true } as any,
          },
        },
        `migration-supplier-fetch-${blingId}`,
      );

      count++;
    }

    console.log(`  → ${count} fornecedores enfileirados até agora...`);
  }

  console.log(`✅ Fornecedores: ${count} total`);
}

// ─── 3. Produto-Fornecedor ────────────────────────────────────────────────────

async function migrateProductSuppliers() {
  console.log('\n🔗 Migrando produto-fornecedores...');
  let count = 0;

  // dataAlteracaoInicial para filtrar mapeamentos recentes
  for await (const page of paginateBling<{
    id: number;
    codigo?: string;
    produto: { id: number };
    fornecedor: { id: number; cnpj?: string; cpf?: string; nome?: string };
  }>('/produtos/fornecedores', { dataAlteracaoInicial: DATA_INICIAL })) {
    for (const ps of page) {
      const blingId = ps.id;
      const jobBase = basePayload('product_supplier', blingId);

      await enqueueDirectUpsert(
        {
          ...jobBase,
          directUpsert: {
            table: 'product_supplier_maps',
            data: {
              productBlingId: ps.produto.id,
              supplierBlingId: ps.fornecedor.id,
              supplier_product_code: ps.codigo ?? '',
            },
          },
        },
        `migration-ps-upsert-${blingId}`,
      );

      await enqueueApiFetch(
        {
          ...jobBase,
          apiFetch: {
            resource: 'product_supplier',
            blingId,
            action: 'created',
            companyId: '',
          },
        },
        `migration-ps-fetch-${blingId}`,
      );

      count++;
    }

    console.log(`  → ${count} mapeamentos enfileirados até agora...`);
  }

  console.log(`✅ Produto-Fornecedores: ${count} total`);
}

// ─── 4. Estoques ──────────────────────────────────────────────────────────────

async function migrateStocks() {
  console.log('\n📊 Migrando estoques...');
  let count = 0;

  // Estoques não possuem filtro de data na Bling v3 — buscamos todos,
  // mas filtramos client-side por dataUltimaMovimentacao se disponível.
  for await (const page of paginateBling<{
    produto: { id: number };
    saldoFisicoTotal: number;
    depositos?: Array<{ saldoFisico: number }>;
    loja?: { id: number };
    dataUltimaMovimentacao?: string; // "YYYY-MM-DD" (se a Bling retornar)
  }>('/estoques')) {
    for (const stock of page) {
      // Filtro client-side de data (quando a Bling retornar o campo)
      if (
        stock.dataUltimaMovimentacao &&
        stock.dataUltimaMovimentacao < DATA_INICIAL
      ) {
        continue;
      }

      if (!stock.loja?.id) {
        console.warn(`Stock produto ${stock.produto.id} sem loja — ignorando`);
        continue;
      }

      const blingId = stock.produto.id;
      const companyId = resolveCompanyId(stock.loja.id);
      const jobBase = basePayload('stock', blingId, companyId);

      await enqueueDirectUpsert(
        {
          ...jobBase,
          directUpsert: {
            table: 'stocks',
            data: {
              productBlingId: blingId,
              quantity: stock.saldoFisicoTotal ?? 0,
            },
          },
        },
        `migration-stock-${blingId}`,
      );

      count++;
    }

    console.log(`  → ${count} estoques enfileirados até agora...`);
  }

  console.log(`✅ Estoques: ${count} total`);
}

// ─── 5. Transportadoras ───────────────────────────────────────────────────────

async function migrateTransporters() {
  console.log('\n🚚 Migrando transportadoras...');
  let count = 0;

  for await (const page of paginateBling<{
    id: number;
    nome: string;
    numeroDocumento?: string;
    fantasia?: string;
    endereco?: { municipio?: string; uf?: string };
    codigo?: string;
  }>('/contatos', { tipoContato: 9, dataAlteracaoInicial: DATA_INICIAL })) {
    for (const transporter of page) {
      const blingId = transporter.id;
      const jobBase = basePayload('product_supplier', blingId);

      await enqueueApiFetch(
        {
          ...jobBase,
          apiFetch: {
            resource: 'product_supplier' as any,
            blingId,
            action: 'created',
            companyId: '',
            partialData: { transporterOnly: true } as any,
          },
        },
        `migration-transporter-fetch-${blingId}`,
      );

      count++;
    }

    console.log(`  → ${count} transportadoras enfileiradas até agora...`);
  }

  console.log(`✅ Transportadoras: ${count} total`);
}

// ─── 6 & 7. Notas Fiscais (NF-e e NFC-e) ─────────────────────────────────────

async function migrateInvoices(type: 'NF-e' | 'NFC-e') {
  const resource = type === 'NF-e' ? 'invoice' : 'consumer_invoice';
  const endpoint = type === 'NF-e' ? '/nfe' : '/nfce';

  console.log(`\n🧾 Migrando ${type}...`);
  let count = 0;

  for await (const page of paginateBling<{
    id: number;
    numero?: string;
    situacao?: number;
    tipo?: number;
    dataEmissao?: string;
    loja?: { id: number };
  }>(endpoint, { dataInicial: DATA_INICIAL })) {
    for (const invoice of page) {
      const blingId = invoice.id;

      if (!invoice.loja?.id) {
        console.warn(`Invoice ${blingId} sem loja — ignorando`);
        continue;
      }

      const companyId = resolveCompanyId(invoice.loja.id);
      const jobBase = basePayload(resource, blingId, companyId);

      await enqueueApiFetch(
        {
          ...jobBase,
          apiFetch: {
            resource: resource as any,
            blingId,
            action: 'created',
            companyId,
            partialData: {
              blingId,
              id_system: String(blingId),
              status: mapSituacao(invoice.situacao),
              type: invoice.tipo === 1 ? 'INCOMING' : 'OUTGOING',
            },
          },
        },
        `migration-${resource}-fetch-${blingId}`,
      );

      count++;
    }

    console.log(`  → ${count} ${type} enfileiradas até agora...`);
  }

  console.log(`✅ ${type}: ${count} total`);
}

function mapSituacao(situacao?: number): 'OPEN' | 'PENDING' | 'FINISHED' | 'CANCELLED' {
  switch (situacao) {
    case 3:
    case 5:
      return 'CANCELLED';
    default:
      return 'OPEN';
  }
}

// ─── Runner principal ─────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  🚀 Bling → Filas — Script de Migração Inicial');
  console.log(`  📅 Período: últimos ${DAYS_BACK} dias (desde ${DATA_INICIAL})`);
  console.log('═══════════════════════════════════════════════════');

  if (DRY_RUN) {
    console.log('⚠️  MODO DRY_RUN: nenhum job será realmente enfileirado.\n');
  }

  const start = Date.now();

  try {
    await loadUnitBusinessMap();

    await migrateProducts();
    await migrateSuppliers();
    await migrateProductSuppliers();
    await migrateStocks();
    await migrateTransporters();
    await migrateInvoices('NF-e');
    await migrateInvoices('NFC-e');
  } catch (err: any) {
    console.error('\n❌ Erro durante a migração:', err.message);
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log('\n═══════════════════════════════════════════════════');
  console.log(`  ✅ Migração concluída em ${elapsed}s`);
  console.log('═══════════════════════════════════════════════════');

  process.exit(0);
}

main();