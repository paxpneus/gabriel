import {
  pickReceiptAnalysisFields,
  toBoardCard,
  toSalesRequestDetail,
} from "../card-serializers";
import {
  PdvCorrectionOrigin,
  PdvCorrectionReason,
  PdvSalesRequestStatus as S,
  PdvShippingType,
} from "../../pdv-sales-request.types";

const fullAnalysis = {
  tipo_comprovante: "pix",
  estabelecimento_nome: "Loja X",
  estabelecimento_cnpj: "00.000.000/0001-00",
  valor_total: 100,
  qtd_parcelas: 1,
  valor_parcela: 100,
  data_transacao: "2026-10-01",
  hora_transacao: "10:00",
  bandeira_cartao: null,
  instituicao_pagamento: "Itaú",
  titular_cartao: null,
  cartao_final: "1234",
  codigo_autorizacao: "A1",
  nsu_cv: "N1",
};

const ANALYSIS_KEYS = [
  "bandeira_cartao",
  "codigo_autorizacao",
  "data_transacao",
  "hora_transacao",
  "instituicao_pagamento",
  "nsu_cv",
  "qtd_parcelas",
  "tipo_comprovante",
  "titular_cartao",
  "valor_parcela",
  "valor_total",
];

const boardRow = {
  id: "r1",
  status: S.OPEN,
  shipping_type: PdvShippingType.ADT,
  correction_origin_status: null,
  cursor_created_at: "2026-10-02 10:00:00.123456+00",
  has_receipt: true,
  sale_invoice_danfe_printed: true,
  order: {
    id: "o1",
    number_order_system: "123",
    number_order_channel: "C-1",
    date: "2026-10-02",
    customer: { name: "Cliente" },
    unitBusiness: { number: "07" },
  },
  saleInvoice: {
    number_system: "5001",
    transporter_name: "LOGISTICA PAX PNEUS SP - CD 12",
    tracking_url: "https://track",
    printed_label: true,
  },
  transferInvoice: { number_system: "7001" },
};

const sortedKeys = (value: object) => Object.keys(value).sort();

describe("toBoardCard", () => {
  it("saleInvoice.batch_name = number do lote do CD21, batch_short_name = só a sequência", () => {
    const card = toBoardCard(
      {
        ...boardRow,
        saleInvoice: {
          ...boardRow.saleInvoice,
          batchInvoice: { id: "bi1", batch: { number: "RODONAVES TRANSPS E ENCOMENDAS LTDA_LOJA21_0842" } },
        },
      },
      "cd21",
    );

    expect(card.saleInvoice).toEqual({
      number_system: "5001",
      tracking_url: "https://track",
      printed_label: true,
      danfe_printed: true,
      batch_name: "RODONAVES TRANSPS E ENCOMENDAS LTDA_LOJA21_0842",
      batch_short_name: "0842",
    });
  });

  it("só os campos do card (sem order.status, customer.document, receipts, errors, createdAt)", () => {
    const card = toBoardCard(boardRow, "store");

    expect(sortedKeys(card)).toEqual(
      ["batch_color", "id", "next_action", "order", "saleInvoice", "shipping_label", "status", "transferInvoice", "warnings"].sort(),
    );
    expect(sortedKeys(card.order!)).toEqual(
      ["customer", "date", "id", "number_order_channel", "number_order_system"].sort(),
    );
    expect(card.order!.customer).toEqual({ name: "Cliente" });
    expect(card.saleInvoice).toEqual({
      number_system: "5001",
      tracking_url: "https://track",
      printed_label: true,
      danfe_printed: true,
      batch_name: null,
      batch_short_name: null,
    });
    expect(card.transferInvoice).toEqual({ number_system: "7001" });
    expect(card.shipping_label).toBe("ADT CD 12");
    expect(card.next_action).toBe("Enviar solicitação para análise");
  });

  it.each(["finance", "cd21", "telesales"] as const)("%s: inclui order.unitBusiness.number", (screen) => {
    expect(toBoardCard(boardRow, screen).order!.unitBusiness).toEqual({ number: "07" });
  });

  it("sem sale_invoice_danfe_printed na linha → saleInvoice.danfe_printed false", () => {
    const { sale_invoice_danfe_printed: _, ...row } = boardRow;
    expect(toBoardCard(row, "cd21").saleInvoice!.danfe_printed).toBe(false);
  });

  it("sem nota de transferência → transferInvoice null", () => {
    expect(toBoardCard({ ...boardRow, transferInvoice: null }, "cd21").transferInvoice).toBeNull();
  });

  it("store: sem order.unitBusiness", () => {
    expect(toBoardCard(boardRow, "store").order).not.toHaveProperty("unitBusiness");
  });

  it.each([
    ["WITHOUT_BATCH", "#FACC15"],
    ["OPEN_BATCH", "#22C55E"],
    ["FINISHED_WITHOUT_DELIVERY_NOTE", "#3B82F6"],
    [null, null],
  ])("batch_stage %s → batch_color %s", (stage, color) => {
    expect(toBoardCard({ ...boardRow, batch_stage: stage }, "cd21").batch_color).toBe(color);
  });

  it.each([
    [{ transfer_quantity_mismatch: true }],
    [{ transfer_products_mismatch: true }],
  ])("aviso crítico %o → batch_color vermelho em qualquer estágio", (flags) => {
    const card = toBoardCard({ ...boardRow, batch_stage: "OPEN_BATCH", ...flags }, "cd21");
    expect(card.batch_color).toBe("#EF4444");
    expect(card.warnings).toHaveLength(1);
  });

  it("next_action respeita has_receipt da linha", () => {
    expect(toBoardCard({ ...boardRow, has_receipt: false }, "store").next_action).toBe(
      "Anexar comprovante e tipo de envio",
    );
  });
});

describe("toSalesRequestDetail", () => {
  const plain = {
    id: "r1",
    unit_business_id: "ub-1",
    order_id: "o1",
    status: S.PENDING_CORRECTION,
    shipping_type: PdvShippingType.TRANSPORTADORA,
    shipping_address: "Rua A",
    transporter_name: "Transp",
    correction_origin_status: S.PENDING_CD21_ANALYSIS,
    errors: {
      origin: PdvCorrectionOrigin.CD21_ANALYSIS,
      reasons: [PdvCorrectionReason.CUSTOMER_NAME],
      note: "corrigir nome",
    },
    origin: null,
    sale_invoice_id: "inv-1",
    transfer_invoice_id: null,
    payment_receipt_analysis: { ...fullAnalysis, payment_methods: [{ id: "pm", description: "PIX" }] },
    payment_receipt_validated: true,
    payment_method_matches_receipt: true,
    receipt_total_matches_order: false,
    receipt_total_difference: -10,
    transfer_invoice_products_match_sale: null,
    order: {
      id: "o1",
      number_order_system: "123",
      number_order_channel: "C-1",
      date: "2026-10-02",
      net_total_order: 110,
      integrations_id: "int-1",
      actual_situation: "9",
      invoice_id: "inv-1",
      source_payload: { parcelas: [{}, {}] },
      customer: { name: "Cliente", document: "123" },
      unitBusiness: { number: "07", name: "Loja 7" },
      payments: [],
      items: [{ id: "i1", name: "Pneu", sku: "P1", quantity: 2, price: 55, extra: "x" }],
    },
    saleInvoice: {
      id: "inv-1",
      number_system: "900",
      transporter_name: "Transp",
      tracking_url: null,
      batchInvoice: { id: "bi1", batch: { number: "TRANSP_X_LOJA21_0007" } },
    },
    transferInvoice: null,
    receipts: [
      { id: "rc1", analysis: { ...fullAnalysis, payment_method: { id: "pm", description: "PIX" } } },
    ],
  };
  const extras = { orderStatus: "Em aberto", expeditionProgress: null, shippingInfoRequired: false };

  it("chaves exatas — sem unit_business_id/order_id/order.id/errors.origin", () => {
    const detail = toSalesRequestDetail(plain, "store", extras);

    expect(sortedKeys(detail)).toEqual(
      [
        "correction_origin_status",
        "errors",
        "expedition_progress",
        "id",
        "next_action",
        "order",
        "origin",
        "payment_method_matches_receipt",
        "payment_receipt_analysis",
        "payment_receipt_validated",
        "receipt_total_difference",
        "receipt_total_matches_order",
        "receipts",
        "saleInvoice",
        "sale_invoice_id",
        "shipping_address",
        "shipping_info_required",
        "shipping_label",
        "shipping_type",
        "status",
        "transferInvoice",
        "transfer_invoice_id",
        "transfer_invoice_products_match_sale",
        "transporter_name",
        "warnings",
      ].sort(),
    );
    expect(detail.errors).toEqual({
      reasons: [PdvCorrectionReason.CUSTOMER_NAME],
      note: "corrigir nome",
    });
    expect(sortedKeys(detail.order!)).toEqual(
      [
        "customer",
        "date",
        "installments",
        "items",
        "net_total_order",
        "number_order_channel",
        "number_order_system",
        "payments",
        "status",
        "unitBusiness",
      ].sort(),
    );
    expect(detail.order!.customer).toEqual({ name: "Cliente", document: "123" });
    expect(detail.order!.net_total_order).toBe(110);
    expect(detail.order!.installments).toBe(2);
    expect(detail.order!.status).toBe("Em aberto");
    expect(detail.order!.unitBusiness).toEqual({ number: "07", name: "Loja 7" });
    expect(detail.order!.items).toEqual([
      { id: "i1", name: "Pneu", sku: "P1", quantity: 2, price: 55 },
    ]);
    expect(detail.receipt_total_difference).toBe(-10);
    expect(detail.next_action).toBe("Confirmar correção");
    expect(detail.shipping_label).toBe("Embarque hoje");
    expect(detail.saleInvoice).toEqual({
      id: "inv-1",
      number_system: "900",
      transporter_name: "Transp",
      tracking_url: null,
      printed_label: false,
      danfe_printed: false,
      batch_name: "TRANSP_X_LOJA21_0007",
      batch_short_name: "0007",
    });
  });

  it("análises sem estabelecimento_*/cartao_final, com payment_methods/payment_method", () => {
    const detail = toSalesRequestDetail(plain, "store", extras);

    expect(sortedKeys(detail.payment_receipt_analysis!)).toEqual(
      [...ANALYSIS_KEYS, "payment_methods"].sort(),
    );
    expect(sortedKeys(detail.receipts[0])).toEqual(["analysis", "id"]);
    expect(sortedKeys(detail.receipts[0].analysis!)).toEqual(
      [...ANALYSIS_KEYS, "payment_method"].sort(),
    );
  });

  it("next_action depende da tela de quem pede", () => {
    expect(toSalesRequestDetail(plain, "finance", extras).next_action).toBeNull();
    expect(toSalesRequestDetail(plain, "cd21", extras).next_action).toBe("Pendente correção");
  });

  it("sem comprovante: OPEN pede comprovante", () => {
    const detail = toSalesRequestDetail(
      { ...plain, status: S.OPEN, receipts: [] },
      "store",
      extras,
    );
    expect(detail.next_action).toBe("Anexar comprovante e tipo de envio");
  });
});

describe("pickReceiptAnalysisFields", () => {
  it("null → null", () => {
    expect(pickReceiptAnalysisFields(null)).toBeNull();
  });

  it("campo ausente vira null; não inventa payment_method(s)", () => {
    const picked = pickReceiptAnalysisFields({ valor_total: 10 });
    expect(sortedKeys(picked!)).toEqual(ANALYSIS_KEYS);
    expect(picked!.tipo_comprovante).toBeNull();
  });
});
