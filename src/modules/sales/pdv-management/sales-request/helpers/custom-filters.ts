import { Sequelize } from "sequelize";

// Filtro por order.number_order_system na listagem de PdvSalesRequest —
// EXISTS correlacionado (nunca "$order.field$"): não depende de nenhum
// include estar presente, então vale igual pro quadro e pras contagens
// agrupadas (countGroupedByStatus, sem join).
export function orderNumberSystemMatchesLiteral(term: string) {
  const escaped = term.replace(/'/g, "''");
  return Sequelize.literal(`EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = "PdvSalesRequest"."order_id"
      AND o.number_order_system ILIKE '%${escaped}%'
  )`);
}

// Filtro por nome do cliente do pedido vinculado — mesmo EXISTS
// correlacionado de orderNumberSystemMatchesLiteral (mesmo motivo).
export function orderCustomerNameMatchesLiteral(term: string) {
  const escaped = term.replace(/'/g, "''");
  return Sequelize.literal(`EXISTS (
    SELECT 1 FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = "PdvSalesRequest"."order_id"
      AND c.name ILIKE '%${escaped}%'
  )`);
}

// Busca livre da listagem (`search`) — combina number_order_system e
// nome/documento do cliente do pedido vinculado, e number_system da nota
// de venda OU de transferência (as duas são FK própria de PdvSalesRequest,
// sem precisar passar por order) num único OR. Usada só por `search`,
// nunca por `filters[...]` — ver PdvSalesRequestService.buildBoardBaseWhere:
// o `search` genérico do QueryParser não serve aqui, já que `searchFields`
// fica vazio pra essa entidade e zeraria o resultado (`where.id = null`).
export function pdvSalesRequestSearchLiteral(term: string) {
  const escaped = term.replace(/'/g, "''");
  const like = `'%${escaped}%'`;

  return Sequelize.literal(`(
    EXISTS (
      SELECT 1 FROM orders o
      JOIN customers c ON c.id = o.customer_id
      WHERE o.id = "PdvSalesRequest"."order_id"
        AND (
          o.number_order_system ILIKE ${like}
          OR c.name ILIKE ${like}
          OR c.document ILIKE ${like}
        )
    )
    OR EXISTS (
      SELECT 1 FROM invoices i
      WHERE i.id IN ("PdvSalesRequest"."sale_invoice_id", "PdvSalesRequest"."transfer_invoice_id")
        AND i.number_system ILIKE ${like}
    )
  )`);
}

// Filtro por período de order.date — mesmo EXISTS correlacionado acima.
// start/end validados como YYYY-MM-DD antes de entrar no literal (nunca
// interpolar direto o que vier de fora sem validar formato).
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function orderDateWithinLiteral(range: {
  start?: string;
  end?: string;
}) {
  const conditions: string[] = [];

  if (range.start && DATE_ONLY.test(range.start)) {
    conditions.push(`o.date >= '${range.start}'::date`);
  }
  if (range.end && DATE_ONLY.test(range.end)) {
    conditions.push(`o.date < ('${range.end}'::date + INTERVAL '1 day')`);
  }

  return Sequelize.literal(`EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = "PdvSalesRequest"."order_id"
      ${conditions.map((c) => `AND ${c}`).join(" ")}
  )`);
}

// Filtro por reason dentro de PdvSalesRequest.errors (JSONB { reasons:
// string[] }) — operador jsonb "?|" testa se QUALQUER elemento do array
// bate com algum dos reasons pedidos, sem precisar decodificar o JSON em
// aplicação.
export function errorsReasonsOverlapLiteral(reasons: string[]) {
  const values = reasons
    .map((reason) => `'${reason.replace(/'/g, "''")}'`)
    .join(",");

  return Sequelize.literal(
    `("PdvSalesRequest"."errors" -> 'reasons') ?| array[${values}]`,
  );
}

// Card do quadro só precisa saber se há comprovante (next_action) — EXISTS
// em vez de include hasMany (servido por idx_pdv_sales_request_receipts_request_id).
export function hasReceiptLiteral() {
  return Sequelize.literal(`EXISTS (
    SELECT 1 FROM pdv_sales_request_receipts r
    WHERE r.pdv_sales_request_id = "PdvSalesRequest"."id"
  )`);
}
