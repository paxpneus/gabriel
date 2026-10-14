/**
 * Reenfileira pra reprocessar:
 *  1. Toda nota de devolução (finNFe = 4) do Bling — passa de novo pelo vínculo com a nota de saída (bondReturnInvoice).
 *  2. Toda nota ainda em PENDING_CANCELLED_SYSTEM (Bling e Tecinco) — passa pelo cancelamento direto (cancelInvoice),
 *     que tira de lote aberto e grava CANCELLED. Precisa zerar antes da migration m313.
 *
 * Uso:
 *   npx ts-node src/scripts/bling/reprocess-return-invoices.ts
 *   DRY_RUN=true npx ts-node src/scripts/bling/reprocess-return-invoices.ts
 */

import { Op } from "sequelize";
import sequelize from "../../config/sequelize";
import { setupAssociations } from "../../config/sequelize-associations";
import { getBlingIntegration } from "../../modules/handlers/bling/api/bling_api.service";
import { BlingApiFetchQueue } from "../../modules/handlers/bling/services/bling/queues/bling-api-fetch.queue";
import { getTCarIntegration } from "../../modules/handlers/tecinco/api/tecinco_api";
import {
  TCAR_INVOICE_UPDATE_JOB_NAME,
  TCarInvoiceQueue,
} from "../../modules/handlers/tecinco/queues/tecinco-invoice.queue";
import { TCarInvoiceXmlPayload } from "../../modules/handlers/tecinco/service/tecinco/tecinco.types";
import Invoice from "../../modules/warehouse/fiscal/invoices/invoice/invoice.model";
import InvoiceUnitBusinessAttributes from "../../modules/warehouse/fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import { isStoredXmlReturnInvoice } from "../../modules/warehouse/fiscal/invoices/invoice/helpers/return-invoice";

const DRY_RUN = process.env.DRY_RUN === "true";
const PAGE_SIZE = 500;
const TCAR_COMPANY_ID = process.env.TCAR_COMPANY_ID ?? "default";
// Status legado — sai do enum na m313; literal só aqui porque o código já não o conhece.
const LEGACY_PENDING_CANCELLED_STATUS = "PENDING_CANCELLED_SYSTEM";

const apiFetchQueue = new BlingApiFetchQueue({ workless: true });
const tcarInvoiceQueue = new TCarInvoiceQueue({ workless: true });
const runId = Date.now();
const enqueuedBlingIds = new Set<number>();

async function enqueueBling(blingId: number, label: string): Promise<boolean> {
  if (enqueuedBlingIds.has(blingId)) return false;
  enqueuedBlingIds.add(blingId);

  const jobId = `reprocess-invoice-${blingId}-${runId}`;
  console.log(`  ${DRY_RUN ? "[DRY_RUN] " : ""}${label} (bling ${blingId}) → ${jobId}`);
  if (!DRY_RUN) {
    await apiFetchQueue.add(
      {
        eventId: jobId,
        resource: "invoice",
        action: "updated",
        companyId: "",
        date: new Date().toISOString(),
        rawData: {},
        apiFetch: {
          resource: "invoice",
          blingId,
          action: "updated",
          companyId: "",
        },
      },
      jobId,
    );
  }
  return true;
}

// Mesmo job invoice_xml do sync Tecinco (enqueueInvoiceUpdates), com a chave composta guardada no source_payload.
async function enqueueTecinco(invoice: Invoice, label: string): Promise<boolean> {
  const payload = invoice.source_payload as any;
  const chave = payload?.chave;
  if (!chave?.nota || !chave?.filial) {
    console.warn(`  ⚠️  ${label} sem chave Tecinco no source_payload (${invoice.id}) — ignorada`);
    return false;
  }

  const branchId = Number(chave.filial);
  const data: TCarInvoiceXmlPayload = {
    numero: chave.nota,
    entrada_saida: payload?.cabecalho?.entrada_saida,
    cln_codigo: chave.cln_codigo,
    tpneg_codigo: chave.tpneg_codigo,
    ntz_codigo: chave.ntz_codigo,
    opr_codigo: chave.opr_codigo,
    serie: chave.serie,
    seq_cancelamento: chave.seq_cancelamento ?? "0",
  };
  const jobId = `reprocess-invoice-tecinco-${branchId}-${chave.nota}-${runId}`;
  console.log(`  ${DRY_RUN ? "[DRY_RUN] " : ""}${label} (tecinco filial ${branchId}) → ${jobId}`);
  if (!DRY_RUN) {
    await tcarInvoiceQueue.add(
      {
        eventId: jobId,
        resource: "invoice_xml",
        action: "sync",
        companyId: TCAR_COMPANY_ID,
        branchId,
        data,
      },
      jobId,
      { priority: 2, name: TCAR_INVOICE_UPDATE_JOB_NAME },
    );
  }
  return true;
}

async function enqueueReturnInvoices(blingIntegrationId: string): Promise<number> {
  let lastId: string | null = null;
  let scanned = 0;
  let enqueued = 0;
  let unreadable = 0;

  for (;;) {
    const page: Invoice[] = await Invoice.findAll({
      where: {
        integrations_id: blingIntegrationId,
        xml_path: { [Op.ne]: null },
        id_system: { [Op.regexp]: "^[0-9]+$" },
        ...(lastId && { id: { [Op.gt]: lastId } }),
      },
      attributes: ["id", "id_system", "number_system", "xml_path"],
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          required: true,
          where: { type: "INCOMING" },
          attributes: [],
        },
      ],
      order: [["id", "ASC"]],
      limit: PAGE_SIZE,
      subQuery: false,
    });
    if (!page.length) break;
    lastId = page[page.length - 1].id;
    scanned += page.length;

    for (const invoice of page) {
      let isReturn = false;
      try {
        isReturn = isStoredXmlReturnInvoice(invoice.xml_path!);
      } catch {
        unreadable++;
        console.warn(`  ⚠️  XML ilegível na nota ${invoice.number_system} (${invoice.id})`);
      }
      if (
        isReturn &&
        (await enqueueBling(Number(invoice.id_system), `Devolução NF ${invoice.number_system}`))
      ) {
        enqueued++;
      }
    }
  }

  console.log(
    `Devoluções: ${scanned} notas de entrada lidas | ${enqueued} ${DRY_RUN ? "encontradas" : "enfileiradas"} | XML ilegível: ${unreadable}`,
  );
  return enqueued;
}

async function enqueuePendingCancelledInvoices(integrationIds: {
  bling: string;
  tecinco: string;
}): Promise<number> {
  // Depois da m313 o valor não existe mais no enum — comparar com ele daria erro.
  const [[{ exists }]] = (await sequelize.query(
    `SELECT '${LEGACY_PENDING_CANCELLED_STATUS}' = ANY(enum_range(NULL::enum_invoice_unit_business_attributes_status)::text[]) AS exists`,
  )) as [{ exists: boolean }[], unknown];
  if (!exists) {
    console.log(`${LEGACY_PENDING_CANCELLED_STATUS}: já removido do enum (m313) — nada a enfileirar`);
    return 0;
  }

  const invoices = await Invoice.findAll({
    where: {
      id: {
        [Op.in]: sequelize.literal(
          `(SELECT invoice_id FROM invoice_unit_business_attributes WHERE status = '${LEGACY_PENDING_CANCELLED_STATUS}')`,
        ),
      },
    },
    attributes: ["id", "id_system", "number_system", "integrations_id", "source_payload"],
    order: [["id", "ASC"]],
  });

  let enqueued = 0;
  let skipped = 0;
  for (const invoice of invoices) {
    const label = `Cancelada pendente NF ${invoice.number_system}`;
    let ok = false;
    if (
      invoice.integrations_id === integrationIds.bling &&
      /^[0-9]+$/.test(invoice.id_system ?? "")
    ) {
      ok = await enqueueBling(Number(invoice.id_system), label);
      // Já enfileirada como devolução: o mesmo job cobre o cancelamento.
      if (!ok && enqueuedBlingIds.has(Number(invoice.id_system))) continue;
    } else if (invoice.integrations_id === integrationIds.tecinco) {
      ok = await enqueueTecinco(invoice, label);
    } else {
      console.warn(`  ⚠️  ${label} de integração sem reprocesso automático (${invoice.id}) — ignorada`);
    }
    if (ok) enqueued++;
    else skipped++;
  }

  console.log(
    `${LEGACY_PENDING_CANCELLED_STATUS}: ${invoices.length} notas | ${enqueued} ${DRY_RUN ? "encontradas" : "enfileiradas"} | ignoradas: ${skipped}`,
  );
  return enqueued;
}

async function main() {
  await sequelize.authenticate();
  setupAssociations();

  const [blingIntegration, tecincoIntegration] = await Promise.all([
    getBlingIntegration(),
    getTCarIntegration(),
  ]);

  await enqueueReturnInvoices(blingIntegration.id);
  await enqueuePendingCancelledInvoices({
    bling: blingIntegration.id,
    tecinco: tecincoIntegration.id,
  });
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
