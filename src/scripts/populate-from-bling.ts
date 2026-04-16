/**
 * bling-migration.script.ts
 *
 * Script de migração inicial: busca todos os dados da Bling e enfileira
 * nas filas existentes (BlingDirectUpsertQueue e BlingApiFetchQueue).
 *
 * ⚠️  ORDEM GARANTIDA — cada etapa espera as filas esvaziarem antes de avançar:
 *   1. Produtos          (DirectUpsert + ApiFetch)
 *   2. Fornecedores      (ApiFetch)
 *   3. Produto-Fornecedor (DirectUpsert + ApiFetch) — precisa de produto pronto
 *   4. Estoques          (DirectUpsert)             — precisa de produto pronto
 *   5. Notas Fiscais NF-e  (ApiFetch)
 *   6. Notas Fiscais NFC-e (ApiFetch)
 *
 * Uso:
 *   npx ts-node bling-migration.script.ts
 *   DRY_RUN=true npx ts-node bling-migration.script.ts
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

async function ensureUnitBusinesses() {
  console.log('🏬 Garantindo UnitBusiness (lojas fixas)...');

  const data = [
    {
      id: "0b7d1604-dd4b-46de-a56d-233ed10e4e7c",
      id_system: "205950316",
      name: "Loja 01 - Assis",
    },
    {
      id: "373ead45-5786-4770-ad7c-8e1fd03b8d23",
      id_system: "205950317",
      name: "Loja 02 - Assis",
    },
    {
      id: "995d2de2-1c32-4e48-a25d-6a2e82726984",
      id_system: "205950318",
      name: "Loja 03 - Santa Cruz",
    },
    {
      id: "c4bfde0e-dfa4-4440-a990-1bdd40e90768",
      id_system: "205950320",
      name: "Loja 04 - Ourinhos",
    },
    {
      id: "29705307-d92b-4c9c-a106-70c7521dc59d",
      id_system: "205950321",
      name: "Loja 05 - Botucatu",
    },
    {
      id: "3ef7dbbf-2d7a-40d6-985f-e5e23f41e26d",
      id_system: "205950322",
      name: "Loja 06 - Bauru",
    },
    {
      id: "33697d8c-853e-40bc-b472-1c921b899c87",
      id_system: "205950323",
      name: "Loja 07 - Marília",
    },
    {
      id: "ff583c88-1f80-43b8-a5e2-1b029813f4eb",
      id_system: "205950324",
      name: "Loja 08 - Marília",
    },
    {
      id: "5c7f46a0-0ae0-4a06-a41f-52fcdcabdeae",
      id_system: "205950326",
      name: "Loja 09 - Lençóis Paulista",
    },
    {
      id: "b350279a-d432-4c74-a768-1db556f13924",
      id_system: "205950327",
      name: "Loja 10 - Lins",
    },
    {
      id: "b673562b-bd7e-4c27-b69f-e9f59f912a2a",
      id_system: "205950328",
      name: "Loja 11 - Londrina",
    },
    {
      id: "1dd88c86-fdcb-407a-a6ab-ee62df3d98ad",
      id_system: "205950330",
      name: "Loja 13 - Cornélio Procópio",
    },
    {
      id: "b77a3525-2bf3-436a-93a2-6f44c6046237",
      id_system: "205950331",
      name: "Loja 14 - Avaré",
    },
    {
      id: "d60d6833-1151-4d75-9163-782de9b4a420",
      id_system: "205948370",
      name: "Loja 15 - Itu",
    },
    {
      id: "60f43f14-7928-48b5-ba51-ab5d669a6617",
      id_system: "205950332",
      name: "Loja 16 - Maringá",
    },
    {
      id: "d7a2f1d5-b26e-43f4-9965-2d0d44a90d77",
      id_system: "205950333",
      name: "Loja 19 - Indaiatuba",
    },
    {
      id: "9b727f99-f511-4082-9907-bd1a4edb819e",
      id_system: "205950335",
      name: "Loja 20 - Ponta Grossa",
    },
    {
      id: "797ad62b-1519-4265-b275-808901f5a656",
      id_system: "205950336",
      name: "Loja 21 - CD MG",
    },
    {
      id: "5b7e071d-1012-454e-aea3-9826cc9ecce9",
      id_system: "205950337",
      name: "Loja 22 - Ourinhos",
    },
    {
      id: "d178f4d4-1ba3-41dd-bfad-e14b68fa2104",
      id_system: "205950339",
      name: "Loja 23 - Indaiatuba",
    },
    {
      id: "a8929658-4a93-4bf0-80ae-0261df47b584",
      id_system: "205737004",
      name: "Loja Pax Meli",
    },
    {
      id: "f3f48264-943b-46ed-8e8b-6598b127b32a",
      id_system: "205955595",
      name: "Site Novo - www.paxpneus.com.br",
    },
    {
      id: "1ee87a98-f33f-4bdd-8633-b9761b0cc046",
      id_system: "",
      name: "Sede Pax Asis",
      number: "1",
      cnpj: "02316749002111",
      head_office: true,
    },
  ];

  for (const item of data) {
    await UnitBusiness.upsert({
      //@ts-ignore
      id: item.id,
      id_system: item.id_system,
      name: item.name,
      number: item.number ?? '',
      cnpj: item.cnpj ?? '',
      integrations_id: "af41c051-ac74-4da0-ad08-c5fe5c7ff8a6",
      head_office: item.head_office ?? false,
      certificate_password: '',
      certificate_path: '',
    });
  }

  console.log(`  → ${data.length} lojas garantidas`);
}

async function bootstrap() {
  await sequelize.authenticate();
  setupAssociations();
}

// ─── Configuração ─────────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN === 'true';

/** Quantos dias atrás buscar todos os recursos */
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

/**
 * Bloqueia até que AMBAS as filas estejam com 0 jobs ativos + aguardando.
 * Garante que os workers terminaram de processar antes de passar para a
 * próxima etapa (evita erros de "produto não encontrado" etc.).
 */
async function waitForQueuesToDrain(label: string) {
  if (DRY_RUN) {
    console.log(`[DRY_RUN] Pulando espera de fila após: ${label}`);
    return;
  }

  console.log(`\n⏳ Aguardando filas esvaziarem após "${label}"...`);

  // Acessa as instâncias BullMQ internas das filas
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

// ─── 1. Produtos ──────────────────────────────────────────────────────────────

async function migrateProducts() {
  console.log('─'.repeat(55));
  console.log('📦  ETAPA 1 — Produtos');
  console.log('─'.repeat(55));

  let count = 0;

  for await (const page of paginateBling<{ id: number; nome: string; codigo: string }>(
    '/produtos',
    { dataAlteracaoInicial: DATA_INICIAL },
  )) {
    for (const product of page) {
      const blingId = product.id;
      const jobBase = basePayload('product', blingId);

      // DirectUpsert: cria o produto com placeholder de EAN
      await enqueueDirectUpsert(
        {
          ...jobBase,
          directUpsert: {
            table: 'products',
            data: {
              blingId,
              name: product.nome ?? '',
              sku:  product.codigo ?? '',
              ean:  `PENDING-${blingId}`,
            },
          },
        },
        `migration-product-upsert-${blingId}`,
      );

      // ApiFetch: complementa com EAN real
      await enqueueApiFetch(
        {
          ...jobBase,
          apiFetch: {
            resource: 'product',
            blingId,
            action:    'created',
            companyId: '',
          },
        },
        `migration-product-fetch-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }

    console.log(`  → ${count} produto(s) enfileirado(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  📦 Produtos enfileirados: ${count}`);

  // ⚠️  Aguarda antes de continuar — fornecedores não dependem de produto,
  //    mas produto-fornecedor e estoque sim.
  await waitForQueuesToDrain('Produtos');
}

// ─── 2. Fornecedores ──────────────────────────────────────────────────────────

async function migrateSuppliers() {
  console.log('─'.repeat(55));
  console.log('🏭  ETAPA 2 — Fornecedores');
  console.log('─'.repeat(55));

  let count = 0;
  const idsParaFiltrar = [
  17977550190, 17950521052, 17950116368, 
  17700189867, 16837235915, 16821258764
];

  for await (const page of paginateBling<{ id: number; nome: string }>(
  '/contatos',
  { 
    tipoContato: 1, // 1 costuma ser Fornecedor no Bling V3
    idsContatos: idsParaFiltrar as any,
    dataAlteracaoInicial: DATA_INICIAL 
  },
  )) {
    for (const supplier of page) {
      const blingId = supplier.id;
      const jobBase = basePayload('supplier', blingId);

      // DirectUpsert: Salva supplier direto com dados do /contatos
      await enqueueDirectUpsert(
        {
          ...jobBase,
          directUpsert: {
            table: 'suppliers',
            data: {
              id_system: String(blingId),
              name: supplier.nome,
              document: `PENDING-${blingId}`, // CNPJ será preenchido em ApiFetch
              fantasy_name: null,
              city: '',
              uf: '',
            },
          },
        },
        `migration-supplier-upsert-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }

    console.log(`  → ${count} fornecedor(es) enfileirado(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  🏭 Fornecedores enfileirados: ${count}`);

  // ⚠️  Aguarda — produto-fornecedor precisa de supplier no banco
  await waitForQueuesToDrain('Fornecedores');
}

// ─── 3. Produto-Fornecedor ────────────────────────────────────────────────────

async function migrateProductSuppliers() {
  console.log('─'.repeat(55));
  console.log('🔗  ETAPA 3 — Produto-Fornecedor');
  console.log('─'.repeat(55));

  let count = 0;

  for await (const page of paginateBling<{
    id: number;
    codigo?: string;
    produto: { id: number };
    fornecedor: { id: number };
  }>('/produtos/fornecedores', { dataAlteracaoInicial: DATA_INICIAL })) {
    for (const ps of page) {
      const blingId = ps.id;
      const jobBase = basePayload('product_supplier', blingId);

      // DirectUpsert: placeholder enquanto ApiFetch resolve CNPJ
      await enqueueDirectUpsert(
        {
          ...jobBase,
          directUpsert: {
            table: 'product_supplier_maps',
            data: {
              productBlingId:        ps.produto.id,
              supplierBlingId:       ps.fornecedor.id,
              supplier_product_code: ps.codigo ?? '',
            },
          },
        },
        `migration-ps-upsert-${blingId}`,
      );

      // ApiFetch: resolve CNPJ real e atualiza o mapeamento
      await enqueueApiFetch(
        {
          ...jobBase,
          apiFetch: {
            resource:  'product_supplier',
            blingId,
            action:    'created',
            companyId: '',
          },
        },
        `migration-ps-fetch-${blingId}`,
      );

      count++;
      if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
    }

    console.log(`  → ${count} mapeamento(s) enfileirado(s)...`);
    if (MAX_PER_ENTITY && count >= MAX_PER_ENTITY) break;
  }

  console.log(`\n  🔗 Produto-Fornecedores enfileirados: ${count}`);

  // ⚠️  Aguarda — estoques precisam do produto já salvo no banco
  await waitForQueuesToDrain('Produto-Fornecedor');
}

// ─── 4. Estoques ──────────────────────────────────────────────────────────────

async function migrateStocks() {
  console.log('─'.repeat(55));
  console.log('📊  ETAPA 4 — Estoques');
  console.log('─'.repeat(55));

  // Coleta todos os blingIds do período
  const allBlingIds: number[] = [];

  for await (const page of paginateBling<{ id: number }>(
    '/produtos',
    { dataAlteracaoInicial: DATA_INICIAL },
  )) {
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

  // ⚠️  Aguarda antes de notas fiscais (boa prática; NF não depende de estoque
  //    mas queremos logs limpos por etapa)
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
  console.log('  🚀 Bling → Filas — Script de Migração Inicial');
  console.log(`  📅 Período: últimos ${DAYS_BACK} dias (desde ${DATA_INICIAL})`);
  console.log('═'.repeat(55));

  if (DRY_RUN) {
    console.log('⚠️  MODO DRY_RUN ativo — nenhum job será enfileirado.\n');
  }

  await bootstrap();

  await loadUnitBusinessMap();

  const start = Date.now();

  try {
    // Ordem garantida + espera entre cada etapa
    await migrateProducts();          // 1 — sem dependências
    await migrateSuppliers();         // 2 — sem dependências
    await migrateProductSuppliers();  // 3 — depende de produto + fornecedor
    await migrateStocks();            // 4 — depende de produto
    await migrateInvoices('NF-e');    // 5 — depende de UnitBusiness
    await migrateInvoices('NFC-e');   // 6 — depende de UnitBusiness
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