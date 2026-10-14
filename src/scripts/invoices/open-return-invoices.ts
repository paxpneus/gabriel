/**
 * Passa pra OPEN toda nota de devolução (finNFe = 4, qualquer integração) que ainda está em
 * WAITING_SCHEDULE_SALES ou FREE_TO_SCHEDULE — devolução não passa por agendamento de recebimento.
 *
 * Uso:
 *   npx ts-node src/scripts/invoices/open-return-invoices.ts
 *   DRY_RUN=true npx ts-node src/scripts/invoices/open-return-invoices.ts
 */

import { Op } from "sequelize";
import sequelize from "../../config/sequelize";
import { setupAssociations } from "../../config/sequelize-associations";
import Invoice from "../../modules/warehouse/fiscal/invoices/invoice/invoice.model";
import invoiceService from "../../modules/warehouse/fiscal/invoices/invoice/invoice.service";
import InvoiceUnitBusinessAttributes from "../../modules/warehouse/fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import { InvoiceUnitBusinessAttributesStatus } from "../../modules/warehouse/fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.types";
import { isStoredXmlReturnInvoice } from "../../modules/warehouse/fiscal/invoices/invoice/helpers/return-invoice";

const DRY_RUN = process.env.DRY_RUN === "true";
const PAGE_SIZE = 500;
const SCHEDULING_STATUSES: InvoiceUnitBusinessAttributesStatus[] = [
  "WAITING_SCHEDULE_SALES",
  "FREE_TO_SCHEDULE",
];

async function main() {
  await sequelize.authenticate();
  setupAssociations();

  let lastId: string | null = null;
  let scanned = 0;
  let opened = 0;
  let unreadable = 0;

  for (;;) {
    const page: Invoice[] = await Invoice.findAll({
      where: {
        xml_path: { [Op.ne]: null },
        ...(lastId && { id: { [Op.gt]: lastId } }),
      },
      attributes: ["id", "number_system", "xml_path"],
      include: [
        {
          model: InvoiceUnitBusinessAttributes,
          as: "unitBusinessAttributes",
          required: true,
          where: {
            type: "INCOMING",
            status: { [Op.in]: SCHEDULING_STATUSES },
          },
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

    const returnInvoices = page.filter((invoice) => {
      try {
        return isStoredXmlReturnInvoice(invoice.xml_path!);
      } catch {
        unreadable++;
        console.warn(`  ⚠️  XML ilegível na nota ${invoice.number_system} (${invoice.id})`);
        return false;
      }
    });
    if (!returnInvoices.length) continue;

    for (const invoice of returnInvoices) {
      console.log(`  ${DRY_RUN ? "[DRY_RUN] " : ""}NF ${invoice.number_system} (${invoice.id}) → OPEN`);
    }
    if (!DRY_RUN) {
      await invoiceService.updateInvoicesForAllUnitBusiness(
        returnInvoices.map((invoice) => invoice.id),
        { status: "OPEN" },
        { type: "INCOMING", status: { [Op.in]: SCHEDULING_STATUSES } },
      );
    }
    opened += returnInvoices.length;
  }

  console.log(
    `\nNotas de entrada em agendamento lidas: ${scanned} | devoluções ${DRY_RUN ? "encontradas" : "passadas pra OPEN"}: ${opened} | XML ilegível: ${unreadable}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
