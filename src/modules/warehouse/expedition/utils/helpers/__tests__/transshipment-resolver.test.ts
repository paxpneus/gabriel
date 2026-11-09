import { Op } from "sequelize";

jest.mock("../../../../fiscal/invoices/invoice/invoice.repository", () => ({
  __esModule: true,
  default: { findInvoiceAttribute: jest.fn(), createInvoiceAttributes: jest.fn() },
}));

jest.mock("../../../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn() },
}));

import invoiceRepository from "../../../../fiscal/invoices/invoice/invoice.repository";
import {
  assertTransshipment,
  batchAttributeWhere,
  isTransshipmentInvoice,
  pickBatchAttribute,
} from "../transshipment-resolver";

const repo = invoiceRepository as unknown as {
  findInvoiceAttribute: jest.Mock;
  createInvoiceAttributes: jest.Mock;
};

const CD = { id: "ub-cd", cnpj: "11.111.111/0001-11", transshipment_allowed: true };
const SENDER_CNPJ = "22222222000122";
const RECEIVER_CNPJ = "33333333000133";
const transitInvoice = {
  id: "inv-1",
  number_system: "1001",
  sender_cnpj: SENDER_CNPJ,
  receiver_cnpj: RECEIVER_CNPJ,
};

beforeEach(() => {
  jest.clearAllMocks();
  repo.findInvoiceAttribute.mockResolvedValue(null);
  repo.createInvoiceAttributes.mockResolvedValue(undefined);
});

describe("isTransshipmentInvoice", () => {
  it("loja nem emissora nem destinatária → transbordo (CNPJ normalizado)", () => {
    expect(isTransshipmentInvoice(transitInvoice, CD.cnpj)).toBe(true);
  });

  it("loja emissora ou destinatária → não é transbordo", () => {
    expect(isTransshipmentInvoice(transitInvoice, "22.222.222/0001-22")).toBe(false);
    expect(isTransshipmentInvoice(transitInvoice, RECEIVER_CNPJ)).toBe(false);
  });
});

describe("pickBatchAttribute", () => {
  const rows = [
    { type: "INCOMING", status: "FINISHED" },
    { type: "OUTGOING", status: "OPEN" },
  ];

  it("transbordo: pega a linha do type do lote, nunca a outra", () => {
    expect(pickBatchAttribute(rows, "OUTGOING", true)).toBe(rows[1]);
    expect(pickBatchAttribute([rows[0]], "OUTGOING", true)).toBeNull();
  });

  it("fora do transbordo: a única linha da loja, qualquer type (comportamento de sempre)", () => {
    expect(pickBatchAttribute([rows[0]], "OUTGOING", false)).toBe(rows[0]);
    expect(pickBatchAttribute([], "OUTGOING", false)).toBeNull();
  });
});

describe("batchAttributeWhere", () => {
  it("sem nota de transbordo: sem filtro (escritas de sempre)", () => {
    expect(batchAttributeWhere("OUTGOING", [])).toBeUndefined();
  });

  it("com transbordo: nota de transbordo só na linha do type, as demais sem filtro", () => {
    expect(batchAttributeWhere("OUTGOING", ["inv-1"])).toEqual({
      [Op.or]: [{ type: "OUTGOING" }, { invoice_id: { [Op.notIn]: ["inv-1"] } }],
    });
  });
});

describe("assertTransshipment", () => {
  it("loja emissora: não é transbordo e não cria linha se já existe (busca sem type)", async () => {
    repo.findInvoiceAttribute.mockResolvedValue({ type: "OUTGOING", status: "OPEN" });

    const result = await assertTransshipment(
      transitInvoice,
      { id: "ub-sender", cnpj: SENDER_CNPJ },
      "OUTGOING",
    );

    expect(result).toBe(false);
    expect(repo.findInvoiceAttribute).toHaveBeenCalledWith("inv-1", "ub-sender", undefined, undefined);
    expect(repo.createInvoiceAttributes).not.toHaveBeenCalled();
  });

  it("loja sem transbordo liberado e fora da nota: bloqueia", async () => {
    await expect(
      assertTransshipment(transitInvoice, { ...CD, transshipment_allowed: false }, "INCOMING"),
    ).rejects.toThrow("Leitura bloqueada");
  });

  it("transbordo de entrada: cria a linha INCOMING da loja", async () => {
    const result = await assertTransshipment(transitInvoice, CD, "INCOMING", "t" as any);

    expect(result).toBe(true);
    expect(repo.findInvoiceAttribute).toHaveBeenCalledWith("inv-1", "ub-cd", "INCOMING", "t");
    expect(repo.createInvoiceAttributes).toHaveBeenCalledWith(
      [
        {
          invoice_id: "inv-1",
          unit_business_id: "ub-cd",
          type: "INCOMING",
          status: "OPEN",
          batch_generated: false,
        },
      ],
      "t",
    );
  });

  it("transbordo de expedição sem entrada finalizada: bloqueia com o número da nota", async () => {
    repo.findInvoiceAttribute.mockResolvedValueOnce({ type: "INCOMING", status: "PENDING" });

    await expect(assertTransshipment(transitInvoice, CD, "OUTGOING")).rejects.toThrow(
      "Nota 1001 ainda não foi recebida nesta loja. Finalize o lote de entrada antes de gerar o de expedição.",
    );
    expect(repo.createInvoiceAttributes).not.toHaveBeenCalled();
  });

  it("transbordo de expedição com entrada finalizada: cria a linha OUTGOING ao lado da INCOMING", async () => {
    repo.findInvoiceAttribute
      .mockResolvedValueOnce({ type: "INCOMING", status: "FINISHED" })
      .mockResolvedValueOnce(null);

    const result = await assertTransshipment(transitInvoice, CD, "OUTGOING");

    expect(result).toBe(true);
    expect(repo.findInvoiceAttribute).toHaveBeenNthCalledWith(1, "inv-1", "ub-cd", "INCOMING", undefined);
    expect(repo.findInvoiceAttribute).toHaveBeenNthCalledWith(2, "inv-1", "ub-cd", "OUTGOING", undefined);
    expect(repo.createInvoiceAttributes).toHaveBeenCalledWith(
      [expect.objectContaining({ type: "OUTGOING", unit_business_id: "ub-cd" })],
      undefined,
    );
  });
});
