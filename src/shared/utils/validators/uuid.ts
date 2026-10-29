import { validate } from "uuid";

// Id de rota/body que vai pra coluna uuid: valida antes da query pra não vazar "invalid input syntax for type uuid".
export function assertUuid(value: unknown, label = "Identificador"): string {
  if (typeof value !== "string" || !validate(value)) throw new Error(`${label} inválido`);
  return value;
}
