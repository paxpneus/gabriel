import { Sequelize } from "sequelize";

// Filtro por order.number_order_system na listagem de PdvSalesRequest —
// EXISTS correlacionado (nunca "$order.field$") porque
// findPaginatedWithOrder já inclui uma association hasMany (receipts), o
// que liga o Sequelize no modo subQuery de paginação; nesse modo, um WHERE
// de nível raiz por alias de association ($order.field$) quebra com
// "missing FROM-clause entry for table order" — o JOIN daquele include só
// existe na query externa, não na subquery de paginação que o Sequelize
// monta por baixo. EXISTS contra orders direto não depende de include
// nenhum, então funciona nos dois modos.
export function orderNumberSystemMatchesLiteral(term: string) {
  const escaped = term.replace(/'/g, "''");
  return Sequelize.literal(`EXISTS (
    SELECT 1 FROM orders o
    WHERE o.id = "PdvSalesRequest"."order_id"
      AND o.number_order_system ILIKE '%${escaped}%'
  )`);
}

// Filtro por nome do cliente do pedido vinculado — mesmo EXISTS
// correlacionado de orderNumberSystemMatchesLiteral (mesmo motivo: modo
// subQuery da paginação por causa do include hasMany de receipts).
export function orderCustomerNameMatchesLiteral(term: string) {
  const escaped = term.replace(/'/g, "''");
  return Sequelize.literal(`EXISTS (
    SELECT 1 FROM orders o
    JOIN customers c ON c.id = o.customer_id
    WHERE o.id = "PdvSalesRequest"."order_id"
      AND c.name ILIKE '%${escaped}%'
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
