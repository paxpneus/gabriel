import { literal, OrderItem } from "sequelize";

// Online primeiro (por nome), depois físicas por `number` numérico — é STRING, cast evita "10" < "2".
export function onlineFirstThenNumberOrder(
  alias: string = "UnitBusiness",
): OrderItem[] {
  return [
    [literal(`CASE WHEN "${alias}"."type" = 'ONLINE' THEN 0 ELSE 1 END`), "ASC"],
    [literal(`CASE WHEN "${alias}"."type" = 'ONLINE' THEN "${alias}"."name" END`), "ASC"],
    [literal(`CASE WHEN "${alias}"."number" ~ '^[0-9]+$' THEN "${alias}"."number"::int END`), "ASC NULLS LAST"],
    [literal(`"${alias}"."name"`), "ASC"],
  ];
}
