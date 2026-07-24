/**
 * update-product-volumes.script.ts
 *
 * Atualiza o campo `volumes` dos produtos na Bling.
 *
 * Regra pra calcular o novo `volumes` (a partir do `source_payload` salvo
 * no banco, só pra decidir o valor — nunca reenviado como body):
 *   - Produto unitário (estrutura.componentes vazio)  → volumes = 1
 *   - Kit (estrutura.componentes com itens)            → volumes = soma das
 *     `quantidade` de estrutura.componentes
 *
 * Estratégia de PUT:
 *   1) Caminho barato (usado pra TODOS os produtos): tenta
 *      `PUT /produtos/{id}` mandando só `{ volumes }`. Não busca nada na
 *      Bling antes — usa o `id_system` já salvo no banco.
 *
 *   2) Fallback (só roda pros produtos em que o PUT mínimo falhar):
 *      NUNCA reenvia o `source_payload` do banco (pode estar desatualizado
 *      — preço, estoque etc. mudam na Bling sem o banco saber). Em vez
 *      disso faz um `GET /produtos/{id}` pra pegar o payload atual e fresco
 *      *daquele produto específico*, sobrescreve `volumes` nele e manda o
 *      PUT completo. Ou seja, só itera produto-por-produto na Bling quando
 *      realmente precisa mandar o objeto inteiro — nunca faz isso
 *      preventivamente pra todos.
 *
 * Uso:
 *   DRY_RUN=true npx ts-node scripts/update-product-volumes.script.ts
 *     → só loga o que faria, não chama a Bling
 *
 *   npx ts-node scripts/update-product-volumes.script.ts
 *     → roda de verdade
 *
 * Variáveis de ambiente:
 *   DRY_RUN               (default: false)
 *   AUTO_FALLBACK           (default: true)  → se o PUT mínimo falhar, busca o produto fresco na Bling e tenta com payload completo
 *   BATCH_SIZE              (default: 200)   → produtos lidos do banco por página
 *   BLING_SCRIPT_PAGE_DELAY_MS (default: 300) → delay entre chamadas à Bling (rate limit)
 *   MAX_PRODUCTS            (default: 0 = sem limite) → útil pra testar com poucos produtos
 */

import { Op } from "sequelize";
import { blingApi } from "../../modules/handlers/bling/api/bling_api.service";
import { Product } from "../../modules/inventory";
import sequelize from "../../config/sequelize";
import { setupAssociations } from "../../config/sequelize-associations";

// ─── Configuração ───────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN === "true";
const AUTO_FALLBACK = process.env.AUTO_FALLBACK !== "false"; // default true
const BATCH_SIZE = Number(process.env.BATCH_SIZE ?? 200);
const PAGE_DELAY_MS = Number(process.env.BLING_SCRIPT_PAGE_DELAY_MS ?? 300);
const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS ?? 5);

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

  try {
    await putFn(`/produtos/${blingId}`, { volumes: newVolumes });
    return "minimal";
  } catch (err: any) {
    if (!autoFallback) throw err;
    console.warn(
      `  ⚠️  PUT mínimo falhou pro produto ${blingId} (${err?.response?.status ?? err.message}). Buscando produto fresco na Bling pra reenviar completo...`,
    );
  }

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
  console.log("═".repeat(60));
  console.log("📦  Atualização de volumes de produtos — Bling");
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
    const products = await Product.findAll({
      where: { source_payload: { [Op.ne]: null } },
      limit: BATCH_SIZE,
      offset,
      order: [["id", "ASC"]],
    });

    if (!products.length) break;

    for (const product of products) {
      processed++;

      const blingProduct = extractBlingProduct(product.source_payload);
      if (!blingProduct) {
        skippedNoPayload++;
        continue;
      }

      const blingId = Number(product.id_system ?? blingProduct.id);
      if (!blingId) {
        skippedNoId++;
        console.warn(`  ⚠️  Produto ${product.id} sem id_system/id da Bling — pulando`);
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
          `  ✅ [${strategy}] Produto ${blingId} (${blingProduct.nome ?? product.name}): volumes ${currentVolumes} → ${newVolumes}`,
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