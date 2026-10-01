import { Literal } from "sequelize/types/utils";
import { Sequelize } from "sequelize";
import sequelize from "../../../config/sequelize";

/** Bucket "YYYY-MM" de uma coluna timestamptz no timezone dado; coluna/alias vêm do código, o timezone é escapado. */
export function monthBucketLiteral(
  column: string,
  timezone: string,
  alias?: string,
): Literal {
  const col = alias ? `"${alias}"."${column}"` : `"${column}"`;
  const tz = sequelize.escape(timezone);
  return Sequelize.literal(
    `to_char(date_trunc('month', ${col} AT TIME ZONE ${tz}), 'YYYY-MM')`,
  );
}
