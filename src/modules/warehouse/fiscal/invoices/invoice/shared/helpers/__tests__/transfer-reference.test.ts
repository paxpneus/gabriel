import { extractTransferReferenceNumber, transferReferenceProblems } from "../transfer-reference";

const ref = (number: string, reference: string | null) => ({
  invoiceId: `inv-${number}`,
  invoiceNumber: number,
  reference,
});
const EXISTING = new Set(["387", "172", "500"]);

describe("extractTransferReferenceNumber", () => {
  it.each([
    ["REF: 782", "782"],
    ["REF 782", "782"],
    ["ref:0782", "782"],
    ["782", "782"],
    ["REF: null", null],
    ["x", null],
    ["  ", null],
    [null, null],
  ])("%p → %p", (reference, expected) => {
    expect(extractTransferReferenceNumber(reference)).toBe(expected);
  });
});

describe("transferReferenceProblems", () => {
  it("sem número e número inexistente → os dois casos + mensagem final do fluxo", () => {
    expect(
      transferReferenceProblems(
        [ref("100", "REF: 387"), ref("101", null), ref("102", "REF: null"), ref("103", "REF 999")],
        EXISTING,
        [],
        "Fim.",
      ),
    ).toBe(
      "Nota(s) de venda sem número da nota de transferência: 101, 102. Nota(s) de transferência entre lojas não encontradas no sistema: 999 (ref. a nota de venda 103). Fim.",
    );
  });

  it("transferência já usada por outra nota no sistema → erro; a linha da própria nota não conta", () => {
    expect(
      transferReferenceProblems(
        [ref("100", "REF: 387"), ref("101", "REF: 172")],
        EXISTING,
        [
          { id: "inv-100", number_system: "100", transfer_number: "387" },
          { id: "inv-other", number_system: "019800", transfer_number: "172" },
        ],
        "Fim.",
      ),
    ).toBe(
      "Nota(s) de transferência já vinculadas a outra nota de venda: 172 (ref. a nota de venda 101, já usada pela nota de venda 019800). Fim.",
    );
  });

  it("duas notas da lista com a mesma transferência (ainda não gravada) → erro nas duas", () => {
    expect(
      transferReferenceProblems([ref("200", "REF: 500"), ref("201", "REF 500")], EXISTING, [], "Fim."),
    ).toBe(
      "Nota(s) de transferência já vinculadas a outra nota de venda: 500 (ref. a nota de venda 200, já usada pela nota de venda 201), 500 (ref. a nota de venda 201, já usada pela nota de venda 200). Fim.",
    );
  });

  it("cada nota com transferência existente e livre (qualquer formato com número) → null", () => {
    expect(
      transferReferenceProblems([ref("100", "REF: 387"), ref("101", "ref 0172")], EXISTING, [], "Fim."),
    ).toBeNull();
  });
});
