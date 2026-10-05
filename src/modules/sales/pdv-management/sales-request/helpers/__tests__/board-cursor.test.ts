import {
  boardCursorAfterLiteral,
  decodeBoardCursor,
  encodeBoardCursor,
} from "../board-cursor";
import { parseBoardQuery, PDV_BOARD_DEFAULT_LIMIT } from "../board-query";
import { PdvBoardParamError } from "../../../helpers/pdv-errors";

const ID = "0b6c8f9e-3f1a-4c1e-9d2b-7a5e4c3b2a10";
const CREATED_AT = "2026-10-02 13:45:12.123456+00";

describe("board-cursor", () => {
  it("encode/decode ida e volta, mantendo os microssegundos", () => {
    expect(decodeBoardCursor(encodeBoardCursor(CREATED_AT, ID))).toEqual({
      c: CREATED_AT,
      i: ID,
    });
  });

  it.each([
    ["não é base64/JSON", "%%%"],
    ["JSON sem os campos", Buffer.from("{}").toString("base64url")],
    [
      "id não é uuid",
      Buffer.from(JSON.stringify({ c: CREATED_AT, i: "1 OR 1=1" })).toString("base64url"),
    ],
    [
      "created_at com injeção",
      Buffer.from(JSON.stringify({ c: "2026-10-02'; DROP TABLE x;--", i: ID })).toString(
        "base64url",
      ),
    ],
  ])("inválido (%s) → PdvBoardParamError", (_label, raw) => {
    expect(() => decodeBoardCursor(raw)).toThrow(PdvBoardParamError);
  });

  it("literal compara (created_at, id) qualificados por PdvSalesRequest", () => {
    const literal = boardCursorAfterLiteral({ c: CREATED_AT, i: ID }) as any;
    expect(literal.val).toBe(
      `("PdvSalesRequest"."created_at", "PdvSalesRequest"."id") > ('${CREATED_AT}'::timestamptz, '${ID}'::uuid)`,
    );
  });
});

describe("parseBoardQuery", () => {
  it("defaults", () => {
    expect(parseBoardQuery({})).toEqual({
      column: null,
      cursor: null,
      limit: PDV_BOARD_DEFAULT_LIMIT,
      includeClosed: false,
      includeOtherScreens: false,
    });
  });

  it("aceita true/false/1/0 nas flags e cursor com column", () => {
    const cursor = encodeBoardCursor(CREATED_AT, ID);
    expect(
      parseBoardQuery({
        column: "finished",
        cursor,
        limit: "30",
        include_closed: "1",
        include_other_screens: "false",
      }),
    ).toEqual({
      column: "finished",
      cursor: { c: CREATED_AT, i: ID },
      limit: 30,
      includeClosed: true,
      includeOtherScreens: false,
    });
  });

  it.each([
    [{ limit: "0" }],
    [{ limit: "101" }],
    [{ limit: "1.5" }],
    [{ limit: "abc" }],
    [{ include_closed: "yes" }],
    [{ column: ["a", "b"] }],
    [{ cursor: encodeBoardCursor(CREATED_AT, ID) }],
    [{ column: "finished", cursor: "lixo" }],
  ])("inválido %p → PdvBoardParamError", (query) => {
    expect(() => parseBoardQuery(query)).toThrow(PdvBoardParamError);
  });
});
