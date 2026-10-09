import { Sequelize } from "sequelize";
import type { PdvTransporterSelector } from "../pdv-sales-request.types";

// Transportadora no formato "LOGISTICA PAX PNEUS SP - CD 12" / "... PR - CD 17".
// \y = word boundary no regex do Postgres; mesmo padrão de shipping-label.ts.
const CD_REGEX = "\\yCD\\s*(\\d+)\\y";
const CD_PATTERN = /\bCD\s*(\d+)\b/i;

// Transportadora própria (logística Pax) — ADT existe só pra esses CDs, e eles só saem como ADT.
export const ADT_TRANSPORTER_CDS: readonly string[] = ["12", "17"];

export function assertAdtTransporterCd(cd: string): void {
  if (!ADT_TRANSPORTER_CDS.includes(cd)) {
    throw new Error(
      `Transportadora inválida — use ${ADT_TRANSPORTER_CDS.map((n) => `CD ${n}`).join(" ou ")}`,
    );
  }
}

// "LOGISTICA PAX PNEUS SP - CD 12" → "12" (null sem nome/sem CD).
export function extractTransporterCd(
  transporterName: string | null | undefined,
): string | null {
  const match = transporterName ? CD_PATTERN.exec(transporterName) : null;
  return match ? match[1] : null;
}

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

// Fragmento SQL: coluna de nome de transportadora contém "CD <n>" de um dos CDs informados.
export function transporterNameMatchesCdsSql(
  column: string,
  cds: readonly string[],
): string {
  return `${column} ~* '\\yCD\\s*(${cds.map(sanitizeCd).join("|")})\\y'`;
}

// Nota de venda cuja transportadora é um dos CDs informados.
export function transporterCdInWhere(
  cds: readonly string[],
  requestAlias = '"PdvSalesRequest"',
) {
  return Sequelize.literal(`EXISTS (
    SELECT 1 FROM invoices i
    WHERE i.id = ${requestAlias}."sale_invoice_id"
      AND ${transporterNameMatchesCdsSql("i.transporter_name", cds)}
  )`);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

// Fragmento SQL do seletor contra as colunas de nome/id de transportadora (id inválido → FALSE, nunca interpolado cru).
export function transporterSelectorSql(
  selector: PdvTransporterSelector,
  columns: { name: string; id: string },
): string {
  if ("cd" in selector) {
    return ADT_TRANSPORTER_CDS.includes(selector.cd)
      ? transporterNameMatchesCdsSql(columns.name, [selector.cd])
      : "FALSE";
  }
  return isUuid(selector.transporterId)
    ? `${columns.id} = '${selector.transporterId}'`
    : "FALSE";
}

export function describeTransporterSelector(
  selector: PdvTransporterSelector,
): string {
  return "cd" in selector
    ? `transportadora CD ${selector.cd}`
    : "transportadora informada";
}

function sanitizeCd(cd: string): string {
  return cd.replace(/\D/g, "");
}
