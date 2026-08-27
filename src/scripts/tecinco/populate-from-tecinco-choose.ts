/**
 * populate-from-tecinco-choose.ts
 *
 * Script de migração com seleção interativa de etapas — estilo Vite.
 * Use as setas ↑↓ para navegar, ESPAÇO para marcar/desmarcar, ENTER para confirmar.
 *
 * Uso:
 *   npx ts-node populate-from-tecinco-choose.ts
 *   DRY_RUN=true npx ts-node populate-from-tecinco-choose.ts
 *
 * Opções de ambiente:
 *   TCAR_COMPANY_ID     → default "default"
 *   TCAR_ALTERADO_DESDE → filtro incremental (YYYY-MM-DD HH:mm:ss); omitido = full
 */

import * as readline from "readline";
import { Op } from "sequelize";
import { setupAssociations } from "../../config/sequelize-associations";
import sequelize from "../../config/sequelize";
import { UnitBusiness } from "../../modules/warehouse";
import { TCarUpsertQueue } from "../../modules/handlers/tecinco/queues/tecinco-api-fetch.queue";
import {
  RunMigrationOptions,
  migrateProdutos,
  migrateClientes,
  migrateNotasFiscais,
} from "./tecinco-migration.runner";
import { tecincoUnitBusinessForPopulate } from "../../shared/constants/tecinco-units";
import { tecincoTireGrupoIds } from "../../shared/constants/tecinco-groups";

// ─── Configuração ─────────────────────────────────────────────────────────────

const DRY_RUN = process.env.DRY_RUN === "true";
const COMPANY_ID = process.env.TCAR_COMPANY_ID ?? "default";
const ALTERADO_DESDE = process.env.TCAR_ALTERADO_DESDE;
const GRUPOS = tecincoTireGrupoIds;

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap() {
  await sequelize.authenticate();
  setupAssociations();
}

// ─── Etapas ───────────────────────────────────────────────────────────────────

const STEPS = [
  {
    key: "products",
    label: "📦  Produtos",
    fn: (opts: Required<RunMigrationOptions>) => migrateProdutos(opts),
  },
  {
    key: "invoices",
    label: "🧾  Notas Fiscais",
    fn: (opts: Required<RunMigrationOptions>) => migrateNotasFiscais(opts),
  },
  {
    key: "customers",
    label: "👥  Clientes",
    fn: (opts: Required<RunMigrationOptions>) => migrateClientes(opts),
  },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

// ─── UI interativa estilo Vite ────────────────────────────────────────────────

function renderMenu(selected: Set<StepKey>, cursor: number) {
  // Limpa as linhas já impressas (STEPS.length + 3 linhas de instrução)
  const totalLines = STEPS.length + 4;
  process.stdout.write(`\x1B[${totalLines}A\x1B[0J`);

  console.log("  Selecione as etapas para migrar:\n");

  STEPS.forEach((step, i) => {
    const isSelected = selected.has(step.key);
    const isCursor = i === cursor;

    const checkbox = isSelected ? "◉" : "◯";
    const pointer = isCursor ? "❯ " : "  ";
    const color = isCursor ? "\x1B[36m" : "\x1B[0m"; // ciano no cursor

    console.log(`${color}${pointer}${checkbox} ${step.label}\x1B[0m`);
  });

  console.log(
    "\n  \x1B[90mESPAÇO para marcar/desmarcar · ENTER para confirmar · A para tudo\x1B[0m",
  );
}

function printInitialMenu() {
  console.log("  Selecione as etapas para migrar:\n");
  STEPS.forEach((step) => console.log(`  ◯ ${step.label}`));
  console.log(
    "\n  \x1B[90mESPAÇO para marcar/desmarcar · ENTER para confirmar · A para tudo\x1B[0m",
  );
}

async function selectSteps(): Promise<StepKey[]> {
  return new Promise((resolve) => {
    const selected = new Set<StepKey>();
    let cursor = 0;

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);

    printInitialMenu();

    process.stdin.on("keypress", (_, key) => {
      if (!key) return;

      if (key.name === "up") {
        cursor = (cursor - 1 + STEPS.length) % STEPS.length;
        renderMenu(selected, cursor);
        return;
      }

      if (key.name === "down") {
        cursor = (cursor + 1) % STEPS.length;
        renderMenu(selected, cursor);
        return;
      }

      if (key.name === "space") {
        const k = STEPS[cursor].key;
        if (selected.has(k)) selected.delete(k);
        else selected.add(k);
        renderMenu(selected, cursor);
        return;
      }

      // Tecla A: seleciona/deseleciona tudo
      if (key.name === "a") {
        if (selected.size === STEPS.length) {
          selected.clear();
        } else {
          STEPS.forEach((s) => selected.add(s.key));
        }
        renderMenu(selected, cursor);
        return;
      }

      if (key.name === "return") {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(Array.from(selected));
        return;
      }

      // Ctrl+C
      if (key.ctrl && key.name === "c") {
        console.log("\n\n  Cancelado.\n");
        process.exit(0);
      }
    });
  });
}

// ─── Runner principal ─────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "═".repeat(55));
  console.log("  🚀 TeCinco Migration — Seleção Interativa");
  if (ALTERADO_DESDE) {
    console.log(`  📅 Incremental desde: ${ALTERADO_DESDE}`);
  } else {
    console.log("  📅 Migração full — sem filtro de data");
  }
  if (DRY_RUN) console.log("  ⚠️  DRY_RUN ativo — nenhum job será enfileirado");
  console.log("═".repeat(55) + "\n");

  // Seleção interativa
  const chosen = await selectSteps();

  if (!chosen.length) {
    console.log("\n  Nenhuma etapa selecionada. Saindo.\n");
    process.exit(0);
  }

  // Resumo do que será executado
  console.log("\n" + "─".repeat(55));
  console.log("  Etapas selecionadas:");
  chosen.forEach((k) => {
    const step = STEPS.find((s) => s.key === k)!;
    console.log(`    ✓ ${step.label}`);
  });
  console.log("─".repeat(55) + "\n");

  // Confirma antes de rodar
  await new Promise<void>((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question("  Confirmar e iniciar? [s/N] ", (answer) => {
      rl.close();
      if (answer.toLowerCase() !== "s") {
        console.log("\n  Cancelado.\n");
        process.exit(0);
      }
      resolve();
    });
  });

  console.log("");

  await bootstrap();

  const units = await UnitBusiness.findAll({
    attributes: ["id", "id_system", "number"],
    where: {
      number: {
        [Op.in]: tecincoUnitBusinessForPopulate,
      },
    },
  });
  const branchIds: number[] = units.map((u) => Number(u.number));

  console.log(`  🏢 Filiais: ${branchIds.join(", ")}\n`);

  const upsertQueue = new TCarUpsertQueue({ workless: true });

  const resolved: Required<RunMigrationOptions> = {
    branchIds,
    companyId: COMPANY_ID,
    alteradoDesde: ALTERADO_DESDE ?? "",
    upsertQueue,
    dryRun: DRY_RUN,
    grupos: GRUPOS,
  };

  const start = Date.now();

  // Executa apenas as etapas escolhidas, na ordem original do array STEPS
  const orderedChosen = STEPS.filter((s) => chosen.includes(s.key));

  try {
    for (const step of orderedChosen) {
      await step.fn(resolved);
    }
  } catch (err: any) {
    console.error("\n❌ Erro durante a migração:", err.message);
    process.exit(1);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("═".repeat(55));
  console.log(`  ✅ Migração concluída em ${elapsed}s`);
  console.log("═".repeat(55));

  process.exit(0);
}

main();
