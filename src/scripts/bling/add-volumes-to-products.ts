/**
 * update-product-volumes.script.ts
 *
 * Atualiza o campo `volumes` dos produtos na Bling.
 *
 * Fonte dos produtos:
 *   Só processa produtos que têm um `integration_mappings` do tipo PRODUCT
 *   apontando pra integração da Bling (`integrations_id = BLING_INTEGRATION_ID`).
 *   O `external_id` desse mapeamento é o id do produto NA BLING — é ele que
 *   é usado nas chamadas à API, não o `id_system` do produto.
 *   O `internal_id` do mapeamento é o id do produto no NOSSO sistema — usado
 *   só pra buscar o `source_payload` (pra calcular o `volumes`).
 *
 * Regra pra calcular o novo `volumes` (a partir do `source_payload` salvo
 * no banco, só pra decidir o valor — nunca reenviado como body):
 *   - Produto unitário (estrutura.componentes vazio)  → volumes = 1
 *   - Kit (estrutura.componentes com itens)            → volumes = soma das
 *     `quantidade` de estrutura.componentes
 *
 * Estratégia de PUT:
 *   1) Caminho barato (usado pra TODOS os produtos): tenta
 *      `PUT /produtos/{external_id}` mandando só `{ volumes }`. Não busca
 *      nada na Bling antes.
 *
 *   2) Fallback (só roda pros produtos em que o PUT mínimo falhar):
 *      NUNCA reenvia o `source_payload` do banco (pode estar desatualizado
 *      — preço, estoque etc. mudam na Bling sem o banco saber). Em vez
 *      disso faz um `GET /produtos/{external_id}` pra pegar o payload atual
 *      e fresco *daquele produto específico*, sobrescreve `volumes` nele e
 *      manda o PUT completo. Ou seja, só itera produto-por-produto na Bling
 *      quando realmente precisa mandar o objeto inteiro — nunca faz isso
 *      preventivamente pra todos.
 *
 * Uso:
 *   BLING_INTEGRATION_ID=<uuid> DRY_RUN=true npx ts-node scripts/update-product-volumes.script.ts
 *     → só loga o que faria, não chama a Bling
 *
 *   BLING_INTEGRATION_ID=<uuid> npx ts-node scripts/update-product-volumes.script.ts
 *     → roda de verdade
 *
 * Variáveis de ambiente:
 *   BLING_INTEGRATION_ID     (obrigatória) → uuid da integração Bling em `integrations`,
 *                                            usado pra filtrar `integration_mappings.integrations_id`
 *   DRY_RUN                  (default: false)
 *   AUTO_FALLBACK            (default: true)  → se o PUT mínimo falhar, busca o produto fresco na Bling e tenta com payload completo
 *   BATCH_SIZE               (default: 200)   → mapeamentos lidos do banco por página
 *   BLING_SCRIPT_PAGE_DELAY_MS (default: 300) → delay entre chamadas à Bling (rate limit)
 *   MAX_PRODUCTS             (default: 0 = sem limite) → útil pra testar com poucos produtos
 */

import { QueryTypes } from "sequelize";
import { blingApi } from "../../modules/handlers/bling/api/bling_api.service";
import sequelize from "../../config/sequelize";
import { setupAssociations } from "../../config/sequelize-associations";

// ─── Configuração ───────────────────────────────────────────────────────────

const BLING_INTEGRATION_ID = process.env.BLING_INTEGRATION_ID ?? "9f2dad31-c321-42c0-9532-249847eb2a26";
const DRY_RUN = process.env.DRY_RUN === "true";
const AUTO_FALLBACK = process.env.AUTO_FALLBACK !== "false"; // default true
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 200);
const PAGE_DELAY_MS = Number(process.env.BLING_SCRIPT_PAGE_DELAY_MS ?? 300);
const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS ?? 5000);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * O source_payload foi salvo exatamente como a Bling retorna, ou seja,
 * `{ "data": { ...produto } }`. Essa função aceita tanto esse formato quanto
 * o objeto do produto já "desembrulhado", por segurança.
 */
export function extractBlingProduct(sourcePayload: any): any | null {
  if (!sourcePayload) return null;
  return sourcePayload.data ?? sourcePayload;
}

/**
 * Calcula o novo valor de `volumes`:
 *  - sem componentes → produto unitário → 1
 *  - com componentes → kit → soma das quantidades dos componentes
 */
export function computeVolumes(blingProduct: any): number {
  const componentes = blingProduct?.estrutura?.componentes ?? [];

  if (!Array.isArray(componentes) || componentes.length === 0) {
    return 1;
  }

  const total = componentes.reduce(
    (sum: number, c: any) => sum + (Number(c?.quantidade) || 0),
    0,
  );

  return total > 0 ? total : 1;
}

/**
 * Busca o produto FRESCO direto na Bling (usado só no fallback, produto a
 * produto — nunca em lote/preventivamente).
 */
export async function fetchFreshBlingProduct(
  blingId: number,
  getFn: (url: string) => Promise<{ data: any }> = blingApi.get,
): Promise<any> {
  const { data } = await getFn(`/produtos/${blingId}`);
  return data?.data ?? data;
}

/**
 * Busca uma página de produtos que têm mapeamento pra Bling, via
 * `integration_mappings` (entity_type = 'PRODUCT', integrations_id = Bling).
 *
 * `external_id`  → id do produto NA BLING (usado nas chamadas à API)
 * `source_payload` → puxado do produto local (internal_id), só pra calcular volumes
 */
export async function fetchProductMappingsPage(
  integrationId: string,
  limit: number,
  offset: number,
): Promise<
  Array<{
    mapping_id: string;
    internal_id: string;
    external_id: string;
    source_payload: any;
    name: string;
  }>
> {
  return sequelize.query(
    `
    SELECT
      im.id AS mapping_id,
      im.internal_id,
      im.external_id,
      p.source_payload,
      p.name
    FROM integration_mappings im
    JOIN products p ON p.id = im.internal_id::uuid
    WHERE im.entity_type = 'PRODUCT'
      AND im.integrations_id = :integrationId::uuid
      AND p.source_payload IS NOT NULL
    ORDER BY im.id ASC
    LIMIT :limit OFFSET :offset
    `,
    {
      replacements: { integrationId, limit, offset },
      type: QueryTypes.SELECT,
    },
  );
}

/**
 * Tenta atualizar o produto na Bling.
 *
 * 1) Caminho barato: PUT só com { volumes }, sem buscar nada antes.
 * 2) Se falhar e AUTO_FALLBACK=true: busca o produto fresco na Bling
 *    (GET individual, só desse produto), sobrescreve volumes nele e manda
 *    o PUT completo com esse payload atualizado — nunca com o
 *    source_payload salvo no banco.
 *
 * Retorna qual estratégia funcionou, pra você ver no log/resumo final
 * qual das duas formas a Bling realmente aceita.
 */
export async function updateVolumeInBling(
  blingId: number,
  currentVolumes: number,
  newVolumes: number,
  options: {
    dryRun?: boolean;
    autoFallback?: boolean;
    putFn?: (url: string, body: any) => Promise<any>;
    getFn?: (url: string) => Promise<{ data: any }>;
  } = {},
): Promise<"minimal" | "full" | "dry-run"> {
  const dryRun = options.dryRun ?? DRY_RUN;
  const autoFallback = options.autoFallback ?? AUTO_FALLBACK;
  const putFn = options.putFn ?? blingApi.put;
  const getFn = options.getFn ?? blingApi.get;

  if (dryRun) {
    console.log(
      `[DRY_RUN] PUT /produtos/${blingId} → volumes: ${currentVolumes} → ${newVolumes}`,
    );
    return "dry-run";
  }

  // try {
  //   await putFn(`/produtos/${blingId}`, { volumes: newVolumes });
  //   return "minimal";
  // } catch (err: any) {
  //   if (!autoFallback) throw err;
  //   console.warn(
  //     `  ⚠️  PUT mínimo falhou pro produto ${blingId} (${err?.response?.status ?? err.message}). Buscando produto fresco na Bling pra reenviar completo...`,
  //   );
  // }

  await sleep(PAGE_DELAY_MS);
  const freshBlingProduct = await fetchFreshBlingProduct(blingId, getFn);

  await putFn(`/produtos/${blingId}`, {
    ...freshBlingProduct,
    volumes: newVolumes,
  });
  return "full";
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────

async function bootstrap() {
  await sequelize.authenticate();
  setupAssociations();
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  if (!BLING_INTEGRATION_ID) {
    throw new Error(
      "BLING_INTEGRATION_ID não definido. Passe o uuid da integração Bling (tabela `integrations`), ex: BLING_INTEGRATION_ID=9f2dad31-c321-42c0-9532-249847eb2a26",
    );
  }

  console.log("═".repeat(60));
  console.log("📦  Atualização de volumes de produtos — Bling");
  console.log(`  Integração Bling (integrations_id): ${BLING_INTEGRATION_ID}`);
  console.log(`  Modo: ${DRY_RUN ? "DRY_RUN (nada será enviado)" : "EXECUÇÃO REAL"}`);
  console.log(
    "  Estratégia: PUT só com { volumes } pra todos" +
      (AUTO_FALLBACK
        ? " — se falhar, busca o produto fresco na Bling (GET individual) e reenvia completo"
        : " — sem fallback (AUTO_FALLBACK=false)"),
  );
  console.log("═".repeat(60));

  await bootstrap();

  let offset = 0;
  let processed = 0;
  let updated = 0;
  let skippedNoPayload = 0;
  let skippedNoChange = 0;
  let skippedNoId = 0;
  let errors = 0;

  const strategyCount = { minimal: 0, full: 0, "dry-run": 0 };

  outer: while (true) {
    const mappings = await fetchProductMappingsPage(
      BLING_INTEGRATION_ID,
      BATCH_SIZE,
      offset,
    );

    if (!mappings.length) break;

    for (const mapping of mappings) {
      processed++;

      const blingProduct = extractBlingProduct(mapping.source_payload);
      if (!blingProduct) {
        skippedNoPayload++;
        continue;
      }

      const blingId = Number(mapping.external_id);
      if (!blingId) {
        skippedNoId++;
        console.warn(
          `  ⚠️  Mapeamento ${mapping.mapping_id} sem external_id válido — pulando`,
        );
        continue;
      }

      const newVolumes = computeVolumes(blingProduct);
      const currentVolumes = Number(blingProduct.volumes ?? 0);

      if (currentVolumes === newVolumes) {
        skippedNoChange++;
        continue;
      }

      try {
        await sleep(PAGE_DELAY_MS);
        const strategy = await updateVolumeInBling(blingId, currentVolumes, newVolumes);
        strategyCount[strategy]++;
        updated++;
        console.log(
          `  ✅ [${strategy}] Produto ${blingId} (${blingProduct.nome ?? mapping.name}): volumes ${currentVolumes} → ${newVolumes}`,
        );
      } catch (err: any) {
        errors++;
        console.error(
          `  ❌ Erro ao atualizar produto ${blingId}: ${err?.response?.status ?? ""} ${err?.response?.data ? JSON.stringify(err.response.data) : err.message}`,
        );
      }

      if (MAX_PRODUCTS && updated + errors >= MAX_PRODUCTS) break outer;
    }

    offset += BATCH_SIZE;
    console.log(`  → ${processed} produto(s) processado(s) até agora...`);
  }

  console.log("═".repeat(60));
  console.log("  ✅ Finalizado");
  console.log(`  Processados: ${processed}`);
  console.log(`  Atualizados: ${updated}`);
  console.log(`    → via PUT mínimo (só volumes): ${strategyCount.minimal}`);
  console.log(`    → via PUT completo (fallback): ${strategyCount.full}`);
  console.log(`  Sem alteração necessária: ${skippedNoChange}`);
  console.log(`  Sem source_payload: ${skippedNoPayload}`);
  console.log(`  Sem id Bling: ${skippedNoId}`);
  console.log(`  Erros: ${errors}`);
  console.log("═".repeat(60));

  process.exit(errors > 0 ? 1 : 0);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("\n❌ Erro fatal:", err);
    process.exit(1);
  });
}