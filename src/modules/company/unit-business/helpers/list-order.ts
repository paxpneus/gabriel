import { literal, OrderItem } from "sequelize";
import sequelize from "../../../../config/sequelize";

// Online primeiro (por nome), depois físicas por `number` numérico — é STRING, cast evita "10" < "2".
export function onlineFirstThenNumberOrder(
  alias: string = "UnitBusiness",
): OrderItem[] {
  const t = sequelize.getQueryInterface().quoteIdentifier(alias);
  return [
    [literal(`CASE WHEN ${t}."type" = 'ONLINE' THEN 0 ELSE 1 END`), "ASC"],
    [literal(`CASE WHEN ${t}."type" = 'ONLINE' THEN ${t}."name" END`), "ASC"],
    [literal(`CASE WHEN ${t}."number" ~ '^[0-9]+$' THEN ${t}."number"::int END`), "ASC NULLS LAST"],
    [literal(`${t}."name"`), "ASC"],
  ];
}
