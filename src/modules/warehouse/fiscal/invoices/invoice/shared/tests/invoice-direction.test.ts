import { resolveInvoiceDirection } from "../helpers/invoice-direction";

describe("resolveInvoiceDirection", () => {
  const invoice = {
    sender_cnpj: "12.345.678/0001-90",
    receiver_cnpj: "98765432000110",
  };

  it("sender = OUTGOING, ignorando máscara", () => {
    expect(resolveInvoiceDirection("12345678000190", invoice)).toBe("OUTGOING");
  });

  it("receiver = INCOMING", () => {
    expect(resolveInvoiceDirection("98.765.432/0001-10", invoice)).toBe("INCOMING");
  });

  it("CNPJ fora da nota = null (transbordo)", () => {
    expect(resolveInvoiceDirection("11111111000111", invoice)).toBeNull();
  });

  it("CNPJ vazio = null", () => {
    expect(resolveInvoiceDirection(null, invoice)).toBeNull();
    expect(resolveInvoiceDirection("", invoice)).toBeNull();
  });

  it("sender e receiver iguais = OUTGOING", () => {
    expect(
      resolveInvoiceDirection("1", { sender_cnpj: "1", receiver_cnpj: "1" }),
    ).toBe("OUTGOING");
  });
});
