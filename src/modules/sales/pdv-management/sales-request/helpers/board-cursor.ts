import { Sequelize } from "sequelize";
import { PdvBoardParamError } from "../../helpers/pdv-errors";

// Cursor composto da ordem fixa do quadro (created_at ASC, id ASC). `c` é o
// created_at como texto do Postgres — Date do JS perderia os microssegundos.
export interface PdvBoardCursor {
  c: string;
  i: string;
}

const TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function encodeBoardCursor(createdAt: string, id: string): string {
  const cursor: PdvBoardCursor = { c: createdAt, i: id };
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeBoardCursor(raw: string): PdvBoardCursor {
  let parsed: any;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    throw new PdvBoardParamError("Cursor inválido.");
  }

  if (
    typeof parsed?.c !== "string" ||
    typeof parsed?.i !== "string" ||
    !TIMESTAMP.test(parsed.c) ||
    !UUID.test(parsed.i)
  ) {
    throw new PdvBoardParamError("Cursor inválido.");
  }

  return { c: parsed.c, i: parsed.i };
}

// Qualificado com "PdvSalesRequest" — a query junta orders/invoices, que
// também têm id/created_at.
export function boardCursorAfterLiteral(cursor: PdvBoardCursor) {
  const createdAt = cursor.c.replace(/'/g, "''");
  const id = cursor.i.replace(/'/g, "''");
  return Sequelize.literal(
    `("PdvSalesRequest"."created_at", "PdvSalesRequest"."id") > ('${createdAt}'::timestamptz, '${id}'::uuid)`,
  );
}
