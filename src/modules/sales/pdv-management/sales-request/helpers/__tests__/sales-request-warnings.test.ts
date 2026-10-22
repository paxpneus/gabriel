import {
  buildCriticalWarnings,
  buildSalesRequestWarnings,
} from "../sales-request-warnings";
import { PdvWarningCode } from "../../pdv-sales-request.types";

describe("buildSalesRequestWarnings", () => {
  it("sem divergência → []", () => {
    expect(
      buildSalesRequestWarnings({
        payment_receipt_validated: true,
        payment_method_matches_receipt: true,
        receipt_total_matches_order: true,
        receipt_total_difference: 0,
        transfer_quantity_mismatch: false,
        transfer_products_mismatch: false,
        transfer_products_unchecked: false,
      }),
    ).toEqual([]);
  });

  it("null (não dá pra comparar) não vira aviso", () => {
    expect(buildSalesRequestWarnings({})).toEqual([]);
  });

  it("diferença em valor → só o vermelho, com valor formatado", () => {
    const warnings = buildSalesRequestWarnings({
      receipt_total_matches_order: false,
      receipt_total_difference: "-1234.5",
    });

    expect(warnings).toEqual([
      {
        code: PdvWarningCode.RECEIPT_TOTAL_DIFFERENCE,
        label: "Comprovantes R$ 1.234,50 abaixo do valor do pedido",
        color: "red",
      },
    ]);
  });

  it("soma não bate sem diferença conhecida → amarelo genérico", () => {
    expect(
      buildSalesRequestWarnings({
        receipt_total_matches_order: false,
        receipt_total_difference: null,
      }).map((w) => w.code),
    ).toEqual([PdvWarningCode.RECEIPT_TOTAL_MISMATCH]);
  });

  it("críticos primeiro, informação por último", () => {
    const warnings = buildSalesRequestWarnings({
      payment_receipt_validated: false,
      payment_method_matches_receipt: false,
      transfer_quantity_mismatch: true,
      transfer_products_mismatch: true,
      transfer_products_unchecked: true,
    });

    expect(warnings.map((w) => [w.code, w.color])).toEqual([
      [PdvWarningCode.TRANSFER_QUANTITY_MISMATCH, "red"],
      [PdvWarningCode.TRANSFER_PRODUCTS_MISMATCH, "red"],
      [PdvWarningCode.TRANSFER_PRODUCTS_UNCHECKED, "yellow"],
      [PdvWarningCode.RECEIPT_INSTALLMENTS_MISMATCH, "yellow"],
      [PdvWarningCode.PAYMENT_METHOD_MISMATCH, "yellow"],
    ]);
  });
});

describe("buildCriticalWarnings", () => {
  it("produto divergente é crítico; produto não mapeado não", () => {
    expect(buildCriticalWarnings({ transfer_products_mismatch: true })).toEqual([
      {
        code: PdvWarningCode.TRANSFER_PRODUCTS_MISMATCH,
        label: "Produtos da NF de transferência divergem da NF de venda",
        color: "red",
      },
    ]);
    expect(buildCriticalWarnings({ transfer_products_unchecked: true })).toEqual([]);
  });

  it("só a divergência entre as notas, nunca o vermelho de valor do comprovante", () => {
    expect(
      buildCriticalWarnings({
        transfer_quantity_mismatch: true,
        transfer_products_mismatch: true,
        receipt_total_matches_order: false,
        receipt_total_difference: -10,
      }).map((w) => w.code),
    ).toEqual([
      PdvWarningCode.TRANSFER_QUANTITY_MISMATCH,
      PdvWarningCode.TRANSFER_PRODUCTS_MISMATCH,
    ]);
    expect(buildCriticalWarnings({ transfer_quantity_mismatch: false })).toEqual([]);
  });

  it("NF de transferência emitida por outra loja que não a do pedido é crítico", () => {
    expect(
      buildCriticalWarnings({ transfer_sender_unit_business_mismatch: true }),
    ).toEqual([
      {
        code: PdvWarningCode.TRANSFER_SENDER_UNIT_BUSINESS_MISMATCH,
        label: "Loja emitente da NF de transferência difere da loja do pedido",
        color: "red",
      },
    ]);
  });
});
