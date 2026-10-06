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
import { TCarInvoiceQueue } from "../../modules/handlers/tecinco/queues/tecinco-invoice.queue";
import {
  RunMigrationOptions,
  ResolvedMigrationOptions,
  migrateProdutos,
  migrateClientes,
  migrateNotasFiscais,
  migrateNovasNotasFiscais,
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
    fn: (opts: ResolvedMigrationOptions) => migrateProdutos(opts),
  },
  {
    key: "invoices",
    label: "🧾  Notas Fiscais (novas + existentes)",
    // Novas primeiro sem esperar; migrateNotasFiscais (só existentes) espera a fila drenar no fim.
    fn: async (opts: ResolvedMigrationOptions) => {
      await migrateNovasNotasFiscais(opts);
      await migrateNotasFiscais(opts);
    },
  },
  {
    key: "customers",
    label: "👥  Clientes",
    fn: (opts: ResolvedMigrationOptions) => migrateClientes(opts),
  },
] as const;

type StepKey = (typeof STEPS)[number]["key"];

type MenuOption<K extends string> = { key: K; label: string };

// ─── UI interativa estilo Vite ────────────────────────────────────────────────

const MENU_HINT =
  "\n  \x1B[90mESPAÇO para marcar/desmarcar · ENTER para confirmar · A para tudo\x1B[0m";

function renderMenu<K extends string>(
  title: string,
  options: readonly MenuOption<K>[],
  selected: Set<K>,
  cursor: number,
  redraw: boolean,
) {
  // Título + linha em branco + opções + linha em branco + dica
  if (redraw) process.stdout.write(`\x1B[${options.length + 4}A\x1B[0J`);

  console.log(`  ${title}\n`);

  options.forEach((option, i) => {
    const checkbox = selected.has(option.key) ? "◉" : "◯";
    const isCursor = i === cursor;
    const pointer = isCursor ? "❯ " : "  ";
    const color = isCursor ? "\x1B[36m" : "\x1B[0m"; // ciano no cursor

    console.log(`${color}${pointer}${checkbox} ${option.label}\x1B[0m`);
  });

  console.log(MENU_HINT);
}

async function selectFromMenu<K extends string>(
  title: string,
  options: readonly MenuOption<K>[],
): Promise<K[]> {
  return new Promise((resolve) => {
    const selected = new Set<K>();
    let cursor = 0;
    const render = () => renderMenu(title, options, selected, cursor, true);

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    process.stdin.resume();

    renderMenu(title, options, selected, cursor, false);

    const onKeypress = (_: string, key: readline.Key) => {
      if (!key) return;

      if (key.name === "up") {
        cursor = (cursor - 1 + options.length) % options.length;
        render();
        return;
      }

      if (key.name === "down") {
        cursor = (cursor + 1) % options.length;
        render();
        return;
      }

      if (key.name === "space") {
        const k = options[cursor].key;
        if (selected.has(k)) selected.delete(k);
        else selected.add(k);
        render();
        return;
      }

      // Tecla A: seleciona/deseleciona tudo
      if (key.name === "a") {
        if (selected.size === options.length) {
          selected.clear();
        } else {
          options.forEach((o) => selected.add(o.key));
        }
        render();
        return;
      }

      if (key.name === "return") {
        // Remove o listener pra não somar com o do próximo menu.
        process.stdin.off("keypress", onKeypress);
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        // Mantém a ordem original das opções, não a ordem de marcação.
        resolve(options.filter((o) => selected.has(o.key)).map((o) => o.key));
        return;
      }

      // Ctrl+C
      if (key.ctrl && key.name === "c") {
        console.log("\n\n  Cancelado.\n");
        process.exit(0);
      }
    };

    process.stdin.on("keypress", onKeypress);
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

  await bootstrap();

  const chosen = await selectFromMenu("Selecione as etapas para migrar:", STEPS);

  if (!chosen.length) {
    console.log("\n  Nenhuma etapa selecionada. Saindo.\n");
    process.exit(0);
  }

  const units = await UnitBusiness.findAll({
    attributes: ["number", "name"],
    where: {
      number: {
        [Op.in]: tecincoUnitBusinessForPopulate,
      },
    },
    order: [["number", "ASC"]],
  });

  if (!units.length) {
    console.log("\n  Nenhuma filial Tecinco cadastrada. Saindo.\n");
    process.exit(0);
  }

  console.log("");
  const chosenBranches = await selectFromMenu(
    "Selecione as lojas para popular:",
    units.map((u) => ({ key: u.number, label: `${u.number} — ${u.name}` })),
  );

  if (!chosenBranches.length) {
    console.log("\n  Nenhuma loja selecionada. Saindo.\n");
    process.exit(0);
  }

  // Resumo do que será executado
  console.log("\n" + "─".repeat(55));
  console.log("  Etapas selecionadas:");
  chosen.forEach((k) => {
    const step = STEPS.find((s) => s.key === k)!;
    console.log(`    ✓ ${step.label}`);
  });
  console.log("  Lojas selecionadas:");
  units
    .filter((u) => chosenBranches.includes(u.number))
    .forEach((u) => console.log(`    ✓ ${u.number} — ${u.name}`));
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

  const branchIds: number[] = chosenBranches.map(Number);

  console.log(`  🏢 Filiais: ${branchIds.join(", ")}\n`);

  const upsertQueue = new TCarUpsertQueue({ workless: true });
  const invoiceQueue = new TCarInvoiceQueue({ workless: true });

  const resolved: ResolvedMigrationOptions = {
    branchIds,
    companyId: COMPANY_ID,
    alteradoDesde: ALTERADO_DESDE ?? "",
    upsertQueue,
    invoiceQueue,
    dryRun: DRY_RUN,
    grupos: GRUPOS,
  };

  const start = Date.now();

  // selectFromMenu já devolve na ordem original do array STEPS
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
