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
const MAX_PRODUCTS = Number(process.env.MAX_PRODUCTS ?? 0);

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * O source_payload foi salvo exatamente como a Bling retorna, ou seja,
 * `{ "data": { ...produto } }`. Essa função aceita tanto esse formato quanto
 * o objeto do produto já "desembrulhado", por segurança.
 */
function extractBlingProduct(sourcePayload: any): any | null {
  if (!sourcePayload) return null;
  return sourcePayload.data ?? sourcePayload;
}

/**
 * Calcula o novo valor de `volumes`:
 *  - sem componentes → produto unitário → 1
 *  - com componentes → kit → soma das quantidades dos componentes
 */
function computeVolumes(blingProduct: any): number {
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
async function fetchFreshBlingProduct(blingId: number): Promise<any> {
  const { data } = await blingApi.get(`/produtos/${blingId}`);
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
async function updateVolumeInBling(
  blingId: number,
  currentVolumes: number,
  newVolumes: number,
): Promise<"minimal" | "full" | "dry-run"> {
  if (DRY_RUN) {
    console.log(
      `[DRY_RUN] PUT /produtos/${blingId} → volumes: ${currentVolumes} → ${newVolumes}`,
    );
    return "dry-run";
  }

  try {
    await blingApi.put(`/produtos/${blingId}`, { volumes: newVolumes });
    return "minimal";
  } catch (err: any) {
    if (!AUTO_FALLBACK) throw err;
    console.warn(
      `  ⚠️  PUT mínimo falhou pro produto ${blingId} (${err?.response?.status ?? err.message}). Buscando produto fresco na Bling pra reenviar completo...`,
    );
  }

  await sleep(PAGE_DELAY_MS);
  const freshBlingProduct = await fetchFreshBlingProduct(blingId);

  await blingApi.put(`/produtos/${blingId}`, {
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

main().catch((err) => {
  console.error("\n❌ Erro fatal:", err);
  process.exit(1);
});