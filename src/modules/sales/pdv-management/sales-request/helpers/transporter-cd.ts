import { Sequelize } from "sequelize";

// Transportadora no formato "LOGISTICA PAX PNEUS SP - CD 12" / "... PR - CD 17".
// \y = word boundary no regex do Postgres; mesmo padrão de shipping-label.ts.
const CD_REGEX = "\\yCD\\s*(\\d+)\\y";

// Número do "CD <n>" do transporter_name da nota de venda (null sem nota/sem CD).
export function saleInvoiceTransporterCdExpression(
  requestAlias = '"PdvSalesRequest"',
) {
  return Sequelize.literal(`(
    SELECT substring(i.transporter_name from '(?i)${CD_REGEX}')
    FROM invoices i
    WHERE i.id = ${requestAlias}."sale_invoice_id"
  )`);
}

// Nota de venda cuja transportadora é um dos CDs informados.
export function transporterCdInWhere(
  cds: readonly string[],
  requestAlias = '"PdvSalesRequest"',
) {
  return Sequelize.literal(`EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = ${requestAlias}."sale_invoice_id"
      AND i.transporter_name ~* '\\yCD\\s*(${cds.map(sanitizeCd).join("|")})\\y'
  )`);
}

function sanitizeCd(cd: string): string {
  return cd.replace(/\D/g, "");
}
