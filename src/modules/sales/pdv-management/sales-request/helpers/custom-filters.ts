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
