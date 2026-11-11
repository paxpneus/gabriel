/**
 * Preenche invoices.invoice_operation_id das notas existentes (depois da m351), pelos mesmos critérios da ingestão.
 * Stub (sem XML e sem source_payload) fica null, igual ao fluxo ao vivo, até o upsert real.
 *
 * Uso:
 *   DRY_RUN=true npx ts-node src/scripts/invoices/backfill-invoice-operations.ts
 *   npx ts-node src/scripts/invoices/backfill-invoice-operations.ts
 */

import { Op, Sequelize } from "sequelize";
import sequelize from "../../config/sequelize";
import { setupAssociations } from "../../config/sequelize-associations";
import Invoice from "../../modules/warehouse/fiscal/invoices/invoice/invoice.model";
import {
  InvoiceDirection,
  invoiceAttributesRepository,
  NFE_RETURN_PURPOSE,
  readNfeIde,
  resolveInvoiceOperationCode,
  xmlHeadLiteral,
} from "../../modules/warehouse/fiscal/invoices/invoice";
import invoiceOperationRepository from "../../modules/warehouse/fiscal/invoices/invoice-operation/invoice-operation.repository";
import {
  INVOICE_OPERATION_CODES,
  InvoiceOperationCode,
} from "../../modules/warehouse/fiscal/invoices/invoice-operation/invoice-operation.types";
import { cleanDocument } from "../../shared/utils/normalizers/document";

const DRY_RUN = process.env.DRY_RUN === "true";
const PAGE_SIZE = 1000;

interface InvoiceRow {
  id: string;
  number_system: string | null;
  sender_cnpj: string | null;
  receiver_cnpj: string | null;
  xml_head: string | null;
  payload_tipo: string | null;
  has_payload: boolean;
}

// Sem <ide> legível no XML, usa o tipo da Bling (0 entrada, 1 saída) — é o que a fila Bling usa ao vivo.
function resolveDirection(row: InvoiceRow, ideDirection: InvoiceDirection | null | undefined): InvoiceDirection | null {
  if (ideDirection) return ideDirection;
  if (row.payload_tipo === "0") return "INCOMING";
  if (row.payload_tipo === "1") return "OUTGOING";
  return null;
}

async function main() {
  await sequelize.authenticate();
  setupAssociations();

  // Id de cada code; aborta se o seed da m351 não rodou.
  const operationIdByCode = new Map<InvoiceOperationCode, string>();
  for (const code of Object.values(INVOICE_OPERATION_CODES)) {
    const id = await invoiceOperationRepository.findIdByCode(code);
    if (!id) throw new Error(`Operação ${code} não encontrada em invoice_operations — rode a m351 antes.`);
    operationIdByCode.set(code, id);
  }

  const unitBusinessCnpjs = new Set(
    (await invoiceAttributesRepository.findAllUnitBusinessCnpjs()).map((cnpj) => cleanDocument(cnpj)),
  );
  const isUnitBusiness = (cnpj: string | null) => !!cnpj && unitBusinessCnpjs.has(cleanDocument(cnpj));

  const alias = sequelize.getQueryInterface().quoteIdentifier("Invoice");
  const countByCode = new Map<InvoiceOperationCode, number>();
  let lastId: string | null = null;
  let scanned = 0;
  let skippedStubs = 0;

  for (;;) {
    const page = (await Invoice.findAll({
      where: {
        invoice_operation_id: { [Op.is]: null },
        ...(lastId && { id: { [Op.gt]: lastId } }),
      },
      attributes: [
        "id",
        "number_system",
        "sender_cnpj",
        "receiver_cnpj",
        [xmlHeadLiteral("Invoice"), "xml_head"],
        [Sequelize.literal(`${alias}."source_payload"->>'tipo'`), "payload_tipo"],
        [Sequelize.literal(`(${alias}."source_payload" IS NOT NULL)`), "has_payload"],
      ],
      order: [["id", "ASC"]],
      limit: PAGE_SIZE,
      raw: true,
    })) as unknown as InvoiceRow[];
    if (!page.length) break;
    lastId = page[page.length - 1].id;
    scanned += page.length;

    // Agrupa por operação pra um UPDATE por code na página.
    const idsByCode = new Map<InvoiceOperationCode, string[]>();
    for (const row of page) {
      if (!row.xml_head && !row.has_payload) {
        skippedStubs++;
        continue;
      }
      const ide = readNfeIde(row.xml_head);
      const code = resolveInvoiceOperationCode({
        senderIsUnitBusiness: isUnitBusiness(row.sender_cnpj),
        receiverIsUnitBusiness: isUnitBusiness(row.receiver_cnpj),
        direction: resolveDirection(row, ide?.operationType),
        isReturn: ide?.purpose === NFE_RETURN_PURPOSE,
        isInternal: false,
      });
      idsByCode.set(code, [...(idsByCode.get(code) ?? []), row.id]);
    }

    // silent: não mexe no updated_at (backfill não é alteração da nota).
    await Promise.all(
      [...idsByCode].map(async ([code, ids]) => {
        countByCode.set(code, (countByCode.get(code) ?? 0) + ids.length);
        if (DRY_RUN) return;
        await Invoice.update(
          { invoice_operation_id: operationIdByCode.get(code)! },
          { where: { id: { [Op.in]: ids } }, silent: true },
        );
      }),
    );
    console.log(`  ${DRY_RUN ? "[DRY_RUN] " : ""}lidas ${scanned} (até ${lastId})`);
  }

  console.log(`\nNotas sem operação lidas: ${scanned} | stubs mantidos sem operação: ${skippedStubs}`);
  for (const code of Object.values(INVOICE_OPERATION_CODES)) {
    console.log(`  ${code}: ${countByCode.get(code) ?? 0} ${DRY_RUN ? "seriam classificadas" : "classificadas"}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
