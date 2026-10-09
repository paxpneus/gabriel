import { PdvBoardParamError } from "../../helpers/pdv-errors";
import { decodeBoardCursor, PdvBoardCursor } from "./board-cursor";
import { PdvSalesRequestStatus } from "../pdv-sales-request.types";

export const PDV_BOARD_DEFAULT_LIMIT = 15;
const PDV_BOARD_MAX_LIMIT = 100;

export interface PdvBoardQuery {
  column: string | null;
  cursor: PdvBoardCursor | null;
  limit: number;
  includeClosed: boolean;
  includeOtherScreens: boolean;
}

function parseSingle(value: unknown, name: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value === "") {
    throw new PdvBoardParamError(`Parâmetro "${name}" inválido.`);
  }
  return value;
}

function parseBoolean(value: unknown, name: string): boolean {
  const raw = parseSingle(value, name);
  if (raw === undefined) return false;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new PdvBoardParamError(`Parâmetro "${name}" deve ser true/false.`);
}

function parseLimit(value: unknown): number {
  const raw = parseSingle(value, "limit");
  if (raw === undefined) return PDV_BOARD_DEFAULT_LIMIT;
  const limit = Number(raw);
  if (!/^\d+$/.test(raw) || limit < 1 || limit > PDV_BOARD_MAX_LIMIT) {
    throw new PdvBoardParamError(
      `Parâmetro "limit" deve ser um inteiro entre 1 e ${PDV_BOARD_MAX_LIMIT}.`,
    );
  }
  return limit;
}

// req.query → parâmetros do quadro; qualquer valor malformado é 400.
export function parseBoardQuery(query: Record<string, unknown>): PdvBoardQuery {
  const column = parseSingle(query.column, "column") ?? null;
  const rawCursor = parseSingle(query.cursor, "cursor");
  if (rawCursor !== undefined && !column) {
    throw new PdvBoardParamError('Parâmetro "cursor" exige "column".');
  }

  return {
    column,
    cursor: rawCursor !== undefined ? decodeBoardCursor(rawCursor) : null,
    limit: parseLimit(query.limit),
    includeClosed: parseBoolean(query.include_closed, "include_closed"),
    includeOtherScreens: parseBoolean(
      query.include_other_screens,
      "include_other_screens",
    ),
  };
}

// `status` do select-all: obrigatório, um só (array/"A,B" → 400).
export function parseSelectAllStatus(value: unknown): PdvSalesRequestStatus {
  const status = parseSingle(value, "status");
  if (status === undefined) {
    throw new PdvBoardParamError('Parâmetro "status" é obrigatório.');
  }
  if (!(Object.values(PdvSalesRequestStatus) as string[]).includes(status)) {
    throw new PdvBoardParamError(`Status "${status}" inválido.`);
  }
  return status as PdvSalesRequestStatus;
}
