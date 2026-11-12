import { Op } from "sequelize";
import { InvoiceOperationFacts, notInternalInvoiceWhere, resolveInvoiceOperationCode } from "../helpers/invoice-operation";
import { INVOICE_OPERATION_CODES } from "../../../invoice-operation/invoice-operation.types";

// Nota "neutra" (nenhuma parte é unit business, sem direção): base dos casos abaixo.
const base: InvoiceOperationFacts = {
  senderIsUnitBusiness: false,
  receiverIsUnitBusiness: false,
  direction: null,
  isReturn: false,
  isInternal: false,
};

describe("resolveInvoiceOperationCode", () => {
  it("nota interna = transferência interna", () => {
    expect(resolveInvoiceOperationCode({ ...base, isInternal: true })).toBe(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER);
  });

  it("finNFe 4 = devolução", () => {
    expect(resolveInvoiceOperationCode({ ...base, isReturn: true })).toBe(INVOICE_OPERATION_CODES.RETURN);
  });

  it("emitente e destinatário unit business = transferência", () => {
    expect(
      resolveInvoiceOperationCode({ ...base, senderIsUnitBusiness: true, receiverIsUnitBusiness: true }),
    ).toBe(INVOICE_OPERATION_CODES.TRANSFER);
  });

  it("emitente unit business + saída = venda", () => {
    expect(
      resolveInvoiceOperationCode({ ...base, senderIsUnitBusiness: true, direction: "OUTGOING" }),
    ).toBe(INVOICE_OPERATION_CODES.SALE);
  });

  it("senão = compra (fornecedor → loja, entrada própria, direção desconhecida)", () => {
    expect(resolveInvoiceOperationCode({ ...base, receiverIsUnitBusiness: true, direction: "OUTGOING" })).toBe(
      INVOICE_OPERATION_CODES.PURCHASE,
    );
    expect(resolveInvoiceOperationCode({ ...base, senderIsUnitBusiness: true, direction: "INCOMING" })).toBe(
      INVOICE_OPERATION_CODES.PURCHASE,
    );
    expect(resolveInvoiceOperationCode({ ...base, senderIsUnitBusiness: true })).toBe(INVOICE_OPERATION_CODES.PURCHASE);
  });

  describe("precedência", () => {
    const all: InvoiceOperationFacts = {
      senderIsUnitBusiness: true,
      receiverIsUnitBusiness: true,
      direction: "OUTGOING",
      isReturn: true,
      isInternal: true,
    };

    it("interna vence devolução e transferência", () => {
      expect(resolveInvoiceOperationCode(all)).toBe(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER);
    });

    it("devolução vence transferência", () => {
      expect(resolveInvoiceOperationCode({ ...all, isInternal: false })).toBe(INVOICE_OPERATION_CODES.RETURN);
    });

    it("transferência vence venda", () => {
      expect(resolveInvoiceOperationCode({ ...all, isInternal: false, isReturn: false })).toBe(
        INVOICE_OPERATION_CODES.TRANSFER,
      );
    });
  });
});

describe("notInternalInvoiceWhere", () => {
  it("mantém nota sem operação (null) e tira só a interna", () => {
    expect(notInternalInvoiceWhere("op-internal")).toEqual({
      invoice_operation_id: { [Op.or]: { [Op.is]: null, [Op.ne]: "op-internal" } },
    });
  });

  it("sem a operação cadastrada não filtra", () => {
    expect(notInternalInvoiceWhere(null)).toEqual({});
  });
});
