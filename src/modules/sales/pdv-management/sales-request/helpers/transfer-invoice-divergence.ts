import { Sequelize } from "sequelize";

// Compara por product_id (já resolvido pelo integration mapping de cada lado): nome/código diferente entre Bling e Tecinco não diverge.
// Ao vivo, não persistido — mapear um item pendente depois já muda o resultado.
const SALE_INVOICE = `"PdvSalesRequest"."sale_invoice_id"`;
const TRANSFER_INVOICE = `"PdvSalesRequest"."transfer_invoice_id"`;
const PENDING_UNMAPPED_STATUS = "UNMAPPED";

function bothInvoicesLinkedSql(): string {
  return `${SALE_INVOICE} IS NOT NULL AND ${TRANSFER_INVOICE} IS NOT NULL`;
}

function hasPendingUnmappedSql(invoiceColumn: string): string {
  return `EXISTS (
    SELECT 1 FROM unmapped_invoice_products u
    WHERE u.invoice_id = ${invoiceColumn}
      AND u.status = '${PENDING_UNMAPPED_STATUS}'
  )`;
}

function hasItemsSql(invoiceColumn: string): string {
  return `EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.invoice_id = ${invoiceColumn})`;
}

// Itens mapeados + linhas ainda não mapeadas (a quantidade não depende do
// mapeamento). NULL sem nenhuma linha (nota provisória) ou com quantidade desconhecida.
function totalQuantitySql(invoiceColumn: string): string {
  return `(
    SELECT CASE WHEN COUNT(*) = COUNT(lines.quantity) THEN SUM(lines.quantity) END
    FROM (
      SELECT ii.quantity_expected AS quantity FROM invoice_items ii
      WHERE ii.invoice_id = ${invoiceColumn}
      UNION ALL
      SELECT u.quantity FROM unmapped_invoice_products u
      WHERE u.invoice_id = ${invoiceColumn}
        AND u.status = '${PENDING_UNMAPPED_STATUS}'
    ) lines
  )`;
}

function quantityByProductSql(invoiceColumn: string): string {
  return `(
    SELECT ii.product_id, SUM(ii.quantity_expected) AS quantity
    FROM invoice_items ii
    WHERE ii.invoice_id = ${invoiceColumn}
    GROUP BY ii.product_id
  )`;
}

// Crítico: total de unidades diferente, ou o mesmo produto com quantidade diferente nas duas notas.
function transferQuantityMismatchSql(): string {
  return `(${bothInvoicesLinkedSql()} AND (
    COALESCE(${totalQuantitySql(SALE_INVOICE)} <> ${totalQuantitySql(TRANSFER_INVOICE)}, FALSE)
    OR EXISTS (
      SELECT 1
      FROM ${quantityByProductSql(SALE_INVOICE)} sale_items
      JOIN ${quantityByProductSql(TRANSFER_INVOICE)} transfer_items
        ON transfer_items.product_id = sale_items.product_id
      WHERE sale_items.quantity <> transfer_items.quantity
    )
  ))`;
}

function productMissingFromSql(fromColumn: string, otherColumn: string): string {
  return `EXISTS (
    SELECT 1 FROM invoice_items a
    WHERE a.invoice_id = ${fromColumn}
      AND NOT EXISTS (
        SELECT 1 FROM invoice_items b
        WHERE b.invoice_id = ${otherColumn} AND b.product_id = a.product_id
      )
  )`;
}

export function transferQuantityMismatchLiteral() {
  return Sequelize.literal(transferQuantityMismatchSql());
}

// Conjunto de produtos diferente. Só compara com as duas notas 100% mapeadas —
// item pendente de mapeamento sumiria de invoice_items e viraria falso positivo.
function transferProductsMismatchSql(): string {
  return `(${bothInvoicesLinkedSql()}
    AND ${hasItemsSql(SALE_INVOICE)} AND ${hasItemsSql(TRANSFER_INVOICE)}
    AND NOT ${hasPendingUnmappedSql(SALE_INVOICE)}
    AND NOT ${hasPendingUnmappedSql(TRANSFER_INVOICE)}
    AND (
      ${productMissingFromSql(SALE_INVOICE, TRANSFER_INVOICE)}
      OR ${productMissingFromSql(TRANSFER_INVOICE, SALE_INVOICE)}
    ))`;
}

export function transferProductsMismatchLiteral() {
  return Sequelize.literal(transferProductsMismatchSql());
}

// Item ainda não mapeado em alguma das duas notas: comparação venda x transferência impossível.
function transferProductsUncheckedSql(): string {
  return `(${bothInvoicesLinkedSql()} AND (
    ${hasPendingUnmappedSql(SALE_INVOICE)} OR ${hasPendingUnmappedSql(TRANSFER_INVOICE)}
  ))`;
}

export function transferProductsUncheckedLiteral() {
  return Sequelize.literal(transferProductsUncheckedSql());
}

// Crítico: NF de transferência emitida por loja (sender_cnpj) diferente da loja do pedido.
// CNPJ já é só dígitos nos dois lados; nota sem sender_cnpj (provisória sem CNPJ) não acusa.
function transferSenderUnitBusinessMismatchSql(): string {
  return `(${TRANSFER_INVOICE} IS NOT NULL AND EXISTS (
    SELECT 1 FROM invoices ti
    JOIN orders o ON o.id = "PdvSalesRequest"."order_id"
    WHERE ti.id = ${TRANSFER_INVOICE}
      AND COALESCE(ti.sender_cnpj, '') <> ''
      AND NOT EXISTS (
        SELECT 1 FROM unit_businesses ub
        WHERE ub.cnpj = ti.sender_cnpj AND ub.id = o.unit_business_id
      )
  ))`;
}

export function transferSenderUnitBusinessMismatchLiteral() {
  return Sequelize.literal(transferSenderUnitBusinessMismatchSql());
}

// Mesmo critério de buildCriticalWarnings — card do quadro, indicativo critical_warnings e CRITICAL_ERROR.
export function criticalWarningLiteral() {
  return Sequelize.literal(
    `(${transferQuantityMismatchSql()} OR ${transferProductsMismatchSql()} OR ${transferSenderUnitBusinessMismatchSql()})`,
  );
}
