/**
 * fix-orders-by-status.ts
 *
 * Corrige pedidos presos numa situação errada, reenfileirando-os no
 * pipeline normal (BlingOrderQueue → BlingOrderService.updateOrderFromBling
 * / createOrderFromBling, que refazem o GET /pedidos/vendas/:id fresco e
 * gravam o pedido de novo).
 *
 * Modo A — busca no NOSSO banco (orders.actual_situation) e reenfileira
 *          `order.updated` pros pedidos encontrados.
 * Modo B — busca DIRETO na Bling (GET /pedidos/vendas?idsSituacoes[]=...)
 *          e reenfileira `order.created` (BlingOrderService já detecta e
 *          delega pra update quando o pedido já existe localmente).
 *
 * Uso interativo:
 *   npx ts-node src/scripts/bling/fix-orders-by-status.ts
 *
 * Uso via args (não-interativo):
 *   npx ts-node src/scripts/bling/fix-orders-by-status.ts --mode a --situations 748772,12
 *   npx ts-node src/scripts/bling/fix-orders-by-status.ts --mode b --situations 748772 --data-inicial 2026-01-01 --data-final 2026-09-11
 *
 * Requer `npm run start:worker` rodando à parte pra consumir os jobs
 * enfileirados — este script só produz, não processa.
 *
 * Opções de ambiente:
 *   DRY_RUN=true → mostra o que seria enfileirado, sem enfileirar de fato
 */

import * as readline from "readline";
import { Op } from "sequelize";
import sequelize from "../../config/sequelize";
import { setupAssociations } from "../../config/sequelize-associations";
import Order from "../../modules/sales/orders/order/orders.model";
import { BlingOrderQueue } from "../../modules/handlers/bling/services/bling-orders/bling-order.queue";
import { blingGet } from "../../modules/handlers/bling/services/bling/helpers/get-with-sleep";
import { blingApi } from "../../modules/handlers/bling/api/bling_api.service";

// ─── Bootstrap ──────────────────────────────────────────────────────────────

async function bootstrap() {
  await sequelize.authenticate();
  setupAssociations();
}

// ─── Config ─────────────────────────────────────────────────────────────────

const DRY_RUN = true

// ─── Fila ───────────────────────────────────────────────────────────────────

const orderQueue = new BlingOrderQueue(null as any, null as any, {
  workless: true,
});

// ─── Menu interativo (seta/enter) ────────────────────────────────────────────

async function selectFromList<T extends string>(
  items: { key: T; label: string; hint: string }[],
  title: string,
): Promise<T> {
  return new Promise((resolve) => {
    let cursor = 0;

    const render = (firstRender: boolean) => {
      if (!firstRender) {
        process.stdout.write(`\x1B[${items.length + 3}A\x1B[0J`);
      }
      console.log(`  ${title}\n`);
      items.forEach((item, i) => {
        const isCursor = i === cursor;
        const pointer = isCursor ? "\x1B[36m❯ " : "  ";
        console.log(`${pointer}${item.label}  \x1B[90m(${item.hint})\x1B[0m`);
      });
      console.log("\n  \x1B[90m↑↓ navegar · ENTER confirmar\x1B[0m");
    };

    readline.emitKeypressEvents(process.stdin);
    if (process.stdin.isTTY) process.stdin.setRawMode(true);
    render(true);

    const handler = (_: any, key: any) => {
      if (!key) return;
      if (key.ctrl && key.name === "c") {
        console.log("\n\n  Cancelado.\n");
        process.exit(0);
      }
      if (key.name === "up") {
        cursor = (cursor - 1 + items.length) % items.length;
        render(false);
        return;
      }
      if (key.name === "down") {
        cursor = (cursor + 1) % items.length;
        render(false);
        return;
      }
      if (key.name === "return") {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.removeListener("keypress", handler);
        process.stdin.pause();
        resolve(items[cursor].key);
      }
    };
    process.stdin.on("keypress", handler);
  });
}

function promptText(question: string, defaultValue?: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const suffix = defaultValue ? ` [${defaultValue}]` : "";
    rl.question(`\n  ${question}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || "");
    });
  });
}

function parseSituations(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ─── Modo A — busca local ─────────────────────────────────────────────────────

async function runModeA(situations: string[]) {
  console.log(
    `\n  🔎 Modo A — buscando pedidos no banco com actual_situation IN (${situations.join(", ")})...`,
  );

  const orders = await Order.findAll({
    where: { actual_situation: { [Op.in]: situations } },
    attributes: ["id", "id_order_system", "number_order_system"],
  });

  console.log(`  → ${orders.length} pedido(s) encontrado(s) no banco.`);

  let enqueued = 0;
  let skipped = 0;

  for (const order of orders) {
    if (!order.id_order_system) {
      console.warn(
        `  ⚠️  Pedido ${order.number_order_system} (id local ${order.id}) sem id_order_system — nunca sincronizado com a Bling, pulando.`,
      );
      skipped++;
      continue;
    }

    const jobId = `fix-status-${order.id_order_system}-${Date.now()}`;

    if (DRY_RUN) {
      console.log(
        `  [DRY_RUN] order.updated → id_order_system=${order.id_order_system} (jobId=${jobId})`,
      );
    } else {
      await orderQueue.add(
        { event: "order.updated", data: { id: Number(order.id_order_system) } },
        jobId,
      );
      console.log(`  ✓ Pedido ${order.number_order_system} reenfileirado.`);
    }
    enqueued++;
  }

  return { found: orders.length, enqueued, skipped };
}

// ─── Modo B — busca direto na Bling ───────────────────────────────────────────

async function runModeB(
  situations: string[],
  dataInicial: string,
  dataFinal: string,
) {
  console.log(
    `\n  🔎 Modo B — buscando pedidos na Bling com idsSituacoes[] IN (${situations.join(", ")}), de ${dataInicial} até ${dataFinal}...`,
  );

  let page = 1;
  let found = 0;
  let enqueued = 0;
  const PAGE_LIMIT = 100;

  while (true) {
    const { data } = await blingGet<{
      data: Array<{ id: number; numero?: string; situacao?: { id?: number } }>;
    }>("/pedidos/vendas", blingApi, {
      params: {
        "idsSituacoes[]": situations,
        dataInicial,
        dataFinal,
        pagina: page,
        limite: PAGE_LIMIT,
      },
    });

    const orders = data?.data ?? [];
    if (orders.length === 0) break;
    found += orders.length;

    for (const blingOrder of orders) {
      const jobId = `fix-status-bling-${blingOrder.id}-${Date.now()}`;

      if (DRY_RUN) {
        console.log(
          `  [DRY_RUN] order.created → id=${blingOrder.id} numero=${blingOrder.numero} (jobId=${jobId})`,
        );
      } else {
        await orderQueue.add(
          { event: "order.created", data: { id: blingOrder.id } },
          jobId,
        );
        console.log(`  ✓ Pedido ${blingOrder.numero ?? blingOrder.id} reenfileirado.`);
      }
      enqueued++;
    }

    console.log(`  → página ${page}: ${orders.length} pedido(s)...`);
    if (orders.length < PAGE_LIMIT) break;
    page++;
  }

  return { found, enqueued, skipped: 0 };
}

// ─── Parse de args CLI ────────────────────────────────────────────────────────

function parseCliArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx === -1 ? undefined : args[idx + 1];
  };

  return {
    mode: get("--mode") as "a" | "b" | undefined,
    situations: get("--situations"),
    dataInicial: get("--data-inicial"),
    dataFinal: get("--data-final"),
  };
}

function defaultDataInicial(): string {
  const d = new Date();
  d.setDate(d.getDate() - 90);
  return d.toISOString().split("T")[0];
}

function defaultDataFinal(): string {
  return new Date().toISOString().split("T")[0];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n" + "═".repeat(55));
  console.log("  🛠️  Correção de Pedidos por Status");
  if (DRY_RUN) console.log("  ⚠️  DRY_RUN ativo — nenhum job será enfileirado");
  console.log("═".repeat(55));

  await bootstrap();

  const cli = parseCliArgs();

  const mode =
    cli.mode ??
    (await selectFromList(
      [
        {
          key: "a" as const,
          label: "🗄️  Modo A — buscar no nosso banco",
          hint: "orders.actual_situation",
        },
        {
          key: "b" as const,
          label: "🌐  Modo B — buscar direto na Bling",
          hint: "GET /pedidos/vendas",
        },
      ],
      "Qual modo de busca?",
    ));

  const situationsRaw =
    cli.situations ??
    (await promptText(
      "Situação(ões) da Bling a corrigir (separadas por vírgula ou espaço, ex: 748772)",
    ));
  const situations = parseSituations(situationsRaw);

  if (situations.length === 0) {
    console.error("\n  ❌ Nenhuma situação informada. Abortando.\n");
    process.exit(1);
  }

  let result: { found: number; enqueued: number; skipped: number };

  if (mode === "a") {
    result = await runModeA(situations);
  } else {
    const dataInicial =
      cli.dataInicial ??
      (await promptText("Data inicial (YYYY-MM-DD)", defaultDataInicial()));
    const dataFinal =
      cli.dataFinal ??
      (await promptText("Data final (YYYY-MM-DD)", defaultDataFinal()));
    result = await runModeB(situations, dataInicial, dataFinal);
  }

  console.log("\n" + "─".repeat(55));
  console.log(
    `  Resumo: ${result.found} encontrado(s) · ${result.enqueued} enfileirado(s) · ${result.skipped} pulado(s)`,
  );
  if (!DRY_RUN && result.enqueued > 0) {
    console.log(
      "  ⏳ Lembre-se: `npm run start:worker` precisa estar rodando pra processar os jobs.",
    );
  }
  console.log("─".repeat(55) + "\n");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\n  ❌ Erro fatal:", err);
    process.exit(1);
  });
