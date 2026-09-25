jest.mock("../../../../../config/sequelize", () => ({
  __esModule: true,
  default: {
    transaction: jest.fn((cb: any) => cb(mockTransaction)),
  },
}));

jest.mock("../pdv-sales-request.repository", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    findActiveByOrderId: jest.fn(),
    findActiveBySaleOrTransferInvoiceId: jest.fn(),
    findShippingBySaleOrTransferInvoiceIds: jest.fn(),
  },
}));

jest.mock("../../sales-request-receipt/pdv-sales-request-receipt.service", () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    findById: jest.fn(),
    findAllByRequestId: jest.fn(),
    findByFingerprint: jest.fn(),
  },
}));

jest.mock("../../sales-request-history/pdv-sales-request-history.service", () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
    findAll: jest.fn(),
  },
}));

jest.mock("../../../orders/order/orders.service", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
    findByIdWithPaymentMethod: jest.fn(),
    isEligibleForPdv: jest.fn(),
  },
}));

jest.mock("../../../../warehouse/fiscal/invoices/invoice/invoice.service", () => ({
  __esModule: true,
  default: {
    findById: jest.fn(),
    findOne: jest.fn(),
    findAll: jest.fn(),
    findDeliveryNoteGeneratedInvoiceIds: jest.fn(),
  },
}));

jest.mock("../../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: { findById: jest.fn(), getCd21UnitBusiness: jest.fn() },
}));

jest.mock("../../../../handlers/uploader/services/uploader.service", () => ({
  __esModule: true,
  default: { upload: jest.fn(), delete: jest.fn() },
}));

jest.mock("../../../../handlers/tecinco/api/tecinco_api", () => ({
  __esModule: true,
  getTCarIntegration: jest.fn(),
}));

jest.mock("../../../../handlers/tecinco/queues/tecinco-api-fetch.queue", () => ({
  __esModule: true,
  TCarUpsertQueue: class {},
}));

jest.mock("../helpers/danfe-interpreter", () => ({
  __esModule: true,
  extractAccessKeyFromDanfe: jest.fn(),
}));

jest.mock("../../../../../shared/utils/xml/access-key", () => ({
  __esModule: true,
  extractAccessKeyFromXmlContent: jest.fn(),
}));

jest.mock(
  "../../../../handlers/bling/services/bling-nfe/nfe-emission.service",
  () => ({
    __esModule: true,
    default: { emitForOrder: jest.fn() },
  }),
);

jest.mock("../payment-receipt-extraction.service", () => ({
  __esModule: true,
  default: { analyze: jest.fn(), computeDerived: jest.fn() },
}));

jest.mock("../../../../handlers/socket/services/socket.service", () => ({
  __esModule: true,
  default: { emitToNamespaceRoom: jest.fn() },
}));

import pdvSalesRequestRepository from "../pdv-sales-request.repository";
import pdvSalesRequestReceiptService from "../../sales-request-receipt/pdv-sales-request-receipt.service";
import pdvSalesRequestHistoryService from "../../sales-request-history/pdv-sales-request-history.service";
import orderService from "../../../orders/order/orders.service";
import invoiceService from "../../../../warehouse/fiscal/invoices/invoice/invoice.service";
import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import uploaderService from "../../../../handlers/uploader/services/uploader.service";
import { getTCarIntegration } from "../../../../handlers/tecinco/api/tecinco_api";
import nfeEmissionService from "../../../../handlers/bling/services/bling-nfe/nfe-emission.service";
import paymentReceiptExtractionService from "../payment-receipt-extraction.service";
import socketService from "../../../../handlers/socket/services/socket.service";
import { PdvSalesRequestService } from "../pdv-sales-request.service";
import {
  PdvCorrectionOrigin,
  PdvCorrectionReason,
  PdvSalesRequestStatus,
  PdvShippingType,
} from "../pdv-sales-request.types";

const mockTransaction = {} as any;

// A análise do comprovante roda fire-and-forget (não é aguardada por
// attachReceipt) — testes que dependem do resultado dela precisam deixar o
// event loop drenar as microtasks antes de checar.
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

const emptyReceiptExtraction = {
  tipo_comprovante: null,
  estabelecimento_nome: null,
  estabelecimento_cnpj: null,
  valor_total: null,
  qtd_parcelas: null,
  valor_parcela: null,
  data_transacao: null,
  hora_transacao: null,
  bandeira_cartao: null,
  instituicao_pagamento: null,
  titular_cartao: null,
  cartao_final: null,
  codigo_autorizacao: null,
  nsu_cv: null,
};

describe("PdvSalesRequestService", () => {
  let service: PdvSalesRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PdvSalesRequestService();
    // Default: análise "vazia" e sem duplicidade — testes que não se
    // importam com a extração de comprovante não precisam mockar isso.
    (paymentReceiptExtractionService.analyze as jest.Mock).mockResolvedValue({
      extraction: emptyReceiptExtraction,
      validated: null,
      fingerprint: null,
    });
    (paymentReceiptExtractionService.computeDerived as jest.Mock).mockReturnValue(
      { validated: null, fingerprint: null },
    );
    // Default: escrita na linha do comprovante resolve sem erro — testes que
    // simulam falha inesperada (ex.: "banco fora do ar") sobrescrevem isso
    // explicitamente, mockRejectedValue não sobrevive fora do próprio teste.
    (pdvSalesRequestReceiptService.update as jest.Mock).mockResolvedValue(
      undefined,
    );
  });

  // ─── createRequest ──────────────────────────────────────────────────────────

  describe("createRequest", () => {
    it("recusa criar uma nova solicitação quando já existe uma ativa pro pedido", async () => {
      (pdvSalesRequestRepository.findActiveByOrderId as jest.Mock).mockResolvedValue(
        { id: "existing" },
      );

      await expect(
        service.createRequest({ orderId: "order-1", name: "Pedido 1" }),
      ).rejects.toThrow("Já existe uma solicitação ativa para este pedido");

      expect(orderService.findById).not.toHaveBeenCalled();
    });

    it("cria com status OPEN e copia sale_invoice_id de order.invoice_id", async () => {
      (pdvSalesRequestRepository.findActiveByOrderId as jest.Mock).mockResolvedValue(
        null,
      );
      (orderService.findById as jest.Mock).mockResolvedValue({
        id: "order-1",
        invoice_id: "invoice-1",
        unit_business_id: "unit-1",
      });
      (unitBusinessService.findById as jest.Mock).mockResolvedValue({
        id: "unit-1",
        type: "PHYSICAL",
        number: "3",
      });
      (unitBusinessService.getCd21UnitBusiness as jest.Mock).mockResolvedValue({
        id: "cd21",
        number: "25",
      });
      (orderService.isEligibleForPdv as jest.Mock).mockResolvedValue(true);
      (pdvSalesRequestRepository.create as jest.Mock).mockResolvedValue({
        id: "request-1",
        status: PdvSalesRequestStatus.OPEN,
      });

      const created = await service.createRequest({
        orderId: "order-1",
        name: "Pedido 1",
      });

      expect(pdvSalesRequestRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          order_id: "order-1",
          unit_business_id: "unit-1",
          sale_invoice_id: "invoice-1",
          transfer_invoice_id: null,
          status: PdvSalesRequestStatus.OPEN,
        }),
        { transaction: mockTransaction },
      );
      expect(pdvSalesRequestHistoryService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pdv_sales_request_id: "request-1",
          step: PdvSalesRequestStatus.OPEN,
        }),
        { transaction: mockTransaction },
      );
      expect(created.id).toBe("request-1");
    });

    it("recusa criar quando o pedido é de loja ONLINE (acesso global, sem ownership check)", async () => {
      (pdvSalesRequestRepository.findActiveByOrderId as jest.Mock).mockResolvedValue(
        null,
      );
      (orderService.findById as jest.Mock).mockResolvedValue({
        id: "order-online",
        invoice_id: "invoice-1",
        unit_business_id: "unit-online",
      });
      (unitBusinessService.findById as jest.Mock).mockResolvedValue({
        id: "unit-online",
        type: "ONLINE",
        number: "50",
      });
      (unitBusinessService.getCd21UnitBusiness as jest.Mock).mockResolvedValue({
        id: "cd21",
        number: "25",
      });

      await expect(
        service.createRequest({ orderId: "order-online" }),
      ).rejects.toThrow("Pedido não é elegível para o fluxo PDV");

      expect(pdvSalesRequestRepository.create).not.toHaveBeenCalled();
    });
  });

  // ─── Máquina de estados — transições válidas/inválidas ─────────────────────

  describe("financeApprove/financeReject", () => {
    it("aprova PENDING_FINANCE -> PENDING_CD21_ANALYSIS e grava histórico", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_FINANCE,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CD21_ANALYSIS,
      });

      await service.financeApprove("r1", "user-1");

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.PENDING_CD21_ANALYSIS },
        { transaction: mockTransaction },
      );
      expect(pdvSalesRequestHistoryService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pdv_sales_request_id: "r1",
          step: PdvSalesRequestStatus.PENDING_CD21_ANALYSIS,
          user_id: "user-1",
        }),
        { transaction: mockTransaction },
      );
    });

    it("recusa aprovar quando a solicitação não está em PENDING_FINANCE", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.OPEN,
      });

      await expect(service.financeApprove("r1")).rejects.toThrow(
        /Ação inválida/,
      );
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });

    it("reprova gravando errors e correction_origin_status=PENDING_FINANCE, indo pra PENDING_CORRECTION", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_FINANCE,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.financeReject("r1", { note: "comprovante ilegível" });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        correction_origin_status: PdvSalesRequestStatus.PENDING_FINANCE,
        errors: {
          origin: PdvCorrectionOrigin.FINANCE,
          reasons: [PdvCorrectionReason.PAYMENT_RECEIPT],
          note: "comprovante ilegível",
        },
      });
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.PENDING_CORRECTION },
        { transaction: mockTransaction },
      );
    });
  });

  describe("resolveCorrection", () => {
    it("origem PENDING_FINANCE: recusa — resolve-se anexando novo comprovante, não por aqui", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.PENDING_FINANCE,
      });

      await expect(service.resolveCorrection("r1", {})).rejects.toThrow(
        /anexando um novo comprovante/,
      );
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });

    it("origem CD21_ANALYSIS: volta pra PENDING_CD21_ANALYSIS (ajuste feito direto na Bling)", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.PENDING_CD21_ANALYSIS,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.resolveCorrection("r1", {});

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.PENDING_CD21_ANALYSIS },
        { transaction: mockTransaction },
      );
    });

    it("origem SHIPPING sem decision: recusa", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.SHIPPING,
      });

      await expect(service.resolveCorrection("r1", {})).rejects.toThrow(
        /decision/,
      );
    });

    it("origem SHIPPING com decision CANCEL: vai pra CANCELLED", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.SHIPPING,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.resolveCorrection("r1", { decision: "CANCEL" });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.CANCELLED },
        { transaction: mockTransaction },
      );
    });

    it("origem SHIPPING com decision EXCHANGE_PRODUCT: volta pra reanálise do CD21", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.SHIPPING,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.resolveCorrection("r1", { decision: "EXCHANGE_PRODUCT" });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.PENDING_CD21_ANALYSIS },
        { transaction: mockTransaction },
      );
    });
  });

  // markSaleInvoiceReady em si é privado — o único caminho de chamada real é
  // o hook automático do sync de pedidos (bling-order.service.ts), via
  // markSaleInvoiceReadyIfPending(orderId).
  describe("markSaleInvoiceReadyIfPending", () => {
    it("envio ADT: vai pra PENDING_NF_TRANSFER", async () => {
      const request = {
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.PENDING_NF_SALE,
        shipping_type: PdvShippingType.ADT,
        sale_invoice_id: "invoice-1",
      };
      (
        pdvSalesRequestRepository.findActiveByOrderId as jest.Mock
      ).mockResolvedValue(request);
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue(
        request,
      );
      (orderService.findById as jest.Mock).mockResolvedValue({
        invoice_id: "invoice-1",
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.markSaleInvoiceReadyIfPending("order-1");

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.PENDING_NF_TRANSFER },
        { transaction: mockTransaction },
      );
    });

    it("envio TRANSPORTADORA: vai direto pra SHIPPING", async () => {
      const request = {
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.PENDING_NF_SALE,
        shipping_type: PdvShippingType.TRANSPORTADORA,
        sale_invoice_id: "invoice-1",
      };
      (
        pdvSalesRequestRepository.findActiveByOrderId as jest.Mock
      ).mockResolvedValue(request);
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue(
        request,
      );
      (orderService.findById as jest.Mock).mockResolvedValue({
        invoice_id: "invoice-1",
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.markSaleInvoiceReadyIfPending("order-1");

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.SHIPPING },
        { transaction: mockTransaction },
      );
    });

    it("re-sincroniza sale_invoice_id quando order.invoice_id mudou desde a criação", async () => {
      const request = {
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.PENDING_NF_SALE,
        shipping_type: PdvShippingType.TRANSPORTADORA,
        sale_invoice_id: "invoice-old",
      };
      (
        pdvSalesRequestRepository.findActiveByOrderId as jest.Mock
      ).mockResolvedValue(request);
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue(
        request,
      );
      (orderService.findById as jest.Mock).mockResolvedValue({
        invoice_id: "invoice-new",
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.markSaleInvoiceReadyIfPending("order-1");

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        sale_invoice_id: "invoice-new",
      });
    });

    it("sem solicitação ativa pro pedido: não faz nada", async () => {
      (
        pdvSalesRequestRepository.findActiveByOrderId as jest.Mock
      ).mockResolvedValue(null);

      await service.markSaleInvoiceReadyIfPending("order-1");

      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });

    it("solicitação ativa mas não em PENDING_NF_SALE: não faz nada", async () => {
      (
        pdvSalesRequestRepository.findActiveByOrderId as jest.Mock
      ).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.SHIPPING,
      });

      await service.markSaleInvoiceReadyIfPending("order-1");

      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });
  });

  describe("generateSaleInvoice", () => {
    it("dispara a emissão na Bling sem mudar status quando em PENDING_NF_SALE", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.PENDING_NF_SALE,
      });
      (nfeEmissionService.emitForOrder as jest.Mock).mockResolvedValue(
        undefined,
      );

      await service.generateSaleInvoice("r1");

      expect(nfeEmissionService.emitForOrder).toHaveBeenCalledWith("order-1");
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });

    it("recusa quando a solicitação não está em PENDING_NF_SALE", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.PENDING_CD21_ANALYSIS,
      });

      await expect(service.generateSaleInvoice("r1")).rejects.toThrow(
        /Ação inválida/,
      );
      expect(nfeEmissionService.emitForOrder).not.toHaveBeenCalled();
    });
  });

  describe("setShippingType", () => {
    it("grava o tipo de envio e histórico, sem avançar status", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
        shipping_type: PdvShippingType.ADT,
      });

      await service.setShippingType("r1", PdvShippingType.ADT);

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        shipping_type: PdvShippingType.ADT,
      });
      expect(pdvSalesRequestHistoryService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pdv_sales_request_id: "r1",
          step: PdvSalesRequestStatus.OPEN,
          description: "Tipo de envio definido",
        }),
      );
    });
  });

  describe("attachReceipt", () => {
    it("cria uma linha de comprovante (nunca substitui as existentes) e NÃO avança status", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (uploaderService.upload as jest.Mock).mockResolvedValue(
        "/pdv-receipts/r1/comprovante.png",
      );
      (pdvSalesRequestReceiptService.create as jest.Mock).mockResolvedValue({
        id: "receipt-1",
        pdv_sales_request_id: "r1",
        path: "/pdv-receipts/r1/comprovante.png",
      });
      // Reconfere que a linha ainda existe antes de gravar a análise —
      // mockar como null aqui faz o job assíncrono desistir cedo, sem sujar
      // este teste com o fluxo de análise (coberto nos testes abaixo).
      (pdvSalesRequestReceiptService.findById as jest.Mock).mockResolvedValue(
        null,
      );

      await service.attachReceipt("r1", {
        buffer: Buffer.from(""),
        filename: "comprovante.png",
        mimeType: "image/png",
      });

      expect(uploaderService.upload).toHaveBeenCalledWith(
        expect.objectContaining({ directory: "/pdv-receipts/r1" }),
      );
      expect(pdvSalesRequestReceiptService.create).toHaveBeenCalledWith({
        pdv_sales_request_id: "r1",
        path: "/pdv-receipts/r1/comprovante.png",
        analysis: null,
        validated: null,
        fingerprint: null,
        created_by_user_id: null,
      });
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
      expect(pdvSalesRequestHistoryService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pdv_sales_request_id: "r1",
          step: PdvSalesRequestStatus.OPEN,
          description: "Comprovante adicionado",
        }),
      );
    });

    it("recusa anexar comprovante quando a correção pendente não é de financeiro", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.PENDING_CD21_ANALYSIS,
      });

      await expect(
        service.attachReceipt("r1", {
          buffer: Buffer.from(""),
          filename: "novo.png",
          mimeType: "image/png",
        }),
      ).rejects.toThrow(/endpoint de correção/);
      expect(uploaderService.upload).not.toHaveBeenCalled();
    });

    it("faz a análise da IA em background, persiste na linha do comprovante e reconcilia com exatamente 1 comprovante", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (uploaderService.upload as jest.Mock).mockResolvedValue(
        "/pdv-receipts/r1/comprovante.png",
      );
      (pdvSalesRequestReceiptService.create as jest.Mock).mockResolvedValue({
        id: "receipt-1",
      });
      const pixExtraction = {
        ...emptyReceiptExtraction,
        tipo_comprovante: "pix",
        valor_total: 100,
      };
      (pdvSalesRequestReceiptService.findById as jest.Mock).mockResolvedValue({
        id: "receipt-1",
      });
      (
        paymentReceiptExtractionService.analyze as jest.Mock
      ).mockResolvedValue({
        extraction: pixExtraction,
        validated: null,
        fingerprint: "fingerprint-1",
      });
      (
        pdvSalesRequestReceiptService.findByFingerprint as jest.Mock
      ).mockResolvedValue(null);
      (
        pdvSalesRequestReceiptService.findAllByRequestId as jest.Mock
      ).mockResolvedValue([
        { id: "receipt-1", analysis: pixExtraction, validated: null },
      ]);
      (
        orderService.findByIdWithPaymentMethod as jest.Mock
      ).mockResolvedValue({
        paymentMethod: { description: "Pix" },
        total_order: 100,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
        payment_receipt_analysis: pixExtraction,
        payment_receipt_validated: null,
        payment_method_matches_receipt: true,
      });

      await service.attachReceipt("r1", {
        buffer: Buffer.from(""),
        filename: "comprovante.png",
        mimeType: "image/png",
      });
      await flushAsync();

      expect(pdvSalesRequestReceiptService.findByFingerprint).toHaveBeenCalledWith(
        "fingerprint-1",
        "receipt-1",
      );
      expect(pdvSalesRequestReceiptService.update).toHaveBeenCalledWith(
        "receipt-1",
        { analysis: pixExtraction, validated: null, fingerprint: "fingerprint-1" },
      );
      // Exatamente 1 comprovante -> payment_method_matches_receipt calculado.
      // valor_total do comprovante bate com order.total_order (100 == 100).
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        payment_receipt_analysis: pixExtraction,
        payment_receipt_validated: null,
        payment_method_matches_receipt: true,
        receipt_total_matches_order: true,
      });
      expect(socketService.emitToNamespaceRoom).toHaveBeenCalledWith(
        "/pdv",
        "pdv-sales-request:r1",
        "payment-receipt-analysis:done",
        expect.objectContaining({
          requestId: "r1",
          receiptId: "receipt-1",
          success: true,
        }),
      );
    });

    it("com 2 comprovantes anexados, payment_method_matches_receipt fica null (financeiro revisa manualmente)", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (uploaderService.upload as jest.Mock).mockResolvedValue(
        "/pdv-receipts/r1/cartao.png",
      );
      (pdvSalesRequestReceiptService.create as jest.Mock).mockResolvedValue({
        id: "receipt-2",
      });
      const cardExtraction = {
        ...emptyReceiptExtraction,
        tipo_comprovante: "cartao_credito",
        valor_total: 50,
      };
      (pdvSalesRequestReceiptService.findById as jest.Mock).mockResolvedValue({
        id: "receipt-2",
      });
      (
        paymentReceiptExtractionService.analyze as jest.Mock
      ).mockResolvedValue({
        extraction: cardExtraction,
        validated: true,
        fingerprint: "fingerprint-2",
      });
      (
        pdvSalesRequestReceiptService.findByFingerprint as jest.Mock
      ).mockResolvedValue(null);
      (
        pdvSalesRequestReceiptService.findAllByRequestId as jest.Mock
      ).mockResolvedValue([
        {
          id: "receipt-1",
          analysis: { ...emptyReceiptExtraction, tipo_comprovante: "pix", valor_total: 50 },
          validated: null,
        },
        { id: "receipt-2", analysis: cardExtraction, validated: true },
      ]);
      (
        orderService.findByIdWithPaymentMethod as jest.Mock
      ).mockResolvedValue({ paymentMethod: null, total_order: 100 });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.attachReceipt("r1", {
        buffer: Buffer.from(""),
        filename: "cartao.png",
        mimeType: "image/png",
      });
      await flushAsync();

      // Sempre busca a order agora (usada pro match de valor total, não só
      // de forma de pagamento) — total 100 bate com a soma dos 2 comprovantes.
      expect(orderService.findByIdWithPaymentMethod).toHaveBeenCalled();
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({
          payment_receipt_analysis: expect.objectContaining({
            tipo_comprovante: "pix + cartao_credito",
            valor_total: 100,
          }),
          payment_receipt_validated: true,
          payment_method_matches_receipt: null,
          receipt_total_matches_order: true,
        }),
      );
    });

    it("detecta duplicidade na análise assíncrona e notifica falha por websocket — não persiste análise nem reconcilia", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (uploaderService.upload as jest.Mock).mockResolvedValue(
        "/pdv-receipts/r1/comprovante.png",
      );
      (pdvSalesRequestReceiptService.create as jest.Mock).mockResolvedValue({
        id: "receipt-1",
      });
      (pdvSalesRequestReceiptService.findById as jest.Mock).mockResolvedValue({
        id: "receipt-1",
      });
      (
        paymentReceiptExtractionService.analyze as jest.Mock
      ).mockResolvedValue({
        extraction: emptyReceiptExtraction,
        validated: null,
        fingerprint: "fingerprint-dup",
      });
      (
        pdvSalesRequestReceiptService.findByFingerprint as jest.Mock
      ).mockResolvedValue({ id: "outro-comprovante" });

      await expect(
        service.attachReceipt("r1", {
          buffer: Buffer.from(""),
          filename: "comprovante.png",
          mimeType: "image/png",
        }),
      ).resolves.toBeDefined();

      await flushAsync();

      expect(socketService.emitToNamespaceRoom).toHaveBeenCalledWith(
        "/pdv",
        "pdv-sales-request:r1",
        "payment-receipt-analysis:done",
        expect.objectContaining({
          requestId: "r1",
          receiptId: "receipt-1",
          success: false,
          reason: "DUPLICATE_RECEIPT",
        }),
      );
      expect(pdvSalesRequestReceiptService.update).not.toHaveBeenCalled();
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });

    it("falha da IA (extração indisponível) não bloqueia o anexo — segue com análise nula, ainda reconcilia e notifica sucesso", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (uploaderService.upload as jest.Mock).mockResolvedValue(
        "/pdv-receipts/r1/comprovante.png",
      );
      (pdvSalesRequestReceiptService.create as jest.Mock).mockResolvedValue({
        id: "receipt-1",
      });
      (pdvSalesRequestReceiptService.findById as jest.Mock).mockResolvedValue({
        id: "receipt-1",
      });
      (paymentReceiptExtractionService.analyze as jest.Mock).mockRejectedValue(
        new Error("Extração indisponível"),
      );
      (
        pdvSalesRequestReceiptService.findAllByRequestId as jest.Mock
      ).mockResolvedValue([{ id: "receipt-1", analysis: null, validated: null }]);
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.attachReceipt("r1", {
        buffer: Buffer.from(""),
        filename: "comprovante.png",
        mimeType: "image/png",
      });
      await flushAsync();

      expect(pdvSalesRequestReceiptService.update).toHaveBeenCalledWith(
        "receipt-1",
        { analysis: null, validated: null, fingerprint: null },
      );
      // Falha da IA vira sucesso com análise null (mesmo grau de "sucesso" de
      // um attach sem IA nenhuma) — front trata analysis: null como "revise
      // manualmente", não como erro.
      expect(socketService.emitToNamespaceRoom).toHaveBeenCalledWith(
        "/pdv",
        "pdv-sales-request:r1",
        "payment-receipt-analysis:done",
        expect.objectContaining({
          requestId: "r1",
          receiptId: "receipt-1",
          success: true,
          analysis: null,
        }),
      );
    });

    it("análise que passa de RECEIPT_ANALYSIS_TIMEOUT_MS vira falha de IA — front não fica esperando indefinidamente", async () => {
      jest.useFakeTimers();
      try {
        (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
          id: "r1",
          order_id: "order-1",
          status: PdvSalesRequestStatus.OPEN,
        });
        (uploaderService.upload as jest.Mock).mockResolvedValue(
          "/pdv-receipts/r1/comprovante.png",
        );
        (pdvSalesRequestReceiptService.create as jest.Mock).mockResolvedValue({
          id: "receipt-1",
        });
        (
          pdvSalesRequestReceiptService.findById as jest.Mock
        ).mockResolvedValue({ id: "receipt-1" });
        (
          pdvSalesRequestReceiptService.findAllByRequestId as jest.Mock
        ).mockResolvedValue([
          { id: "receipt-1", analysis: null, validated: null },
        ]);
        (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
          id: "r1",
        });
        // nunca resolve — simula extração lenta (pico de demanda)
        (paymentReceiptExtractionService.analyze as jest.Mock).mockReturnValue(
          new Promise(() => {}),
        );

        await service.attachReceipt("r1", {
          buffer: Buffer.from(""),
          filename: "comprovante.png",
          mimeType: "image/png",
        });

        await jest.advanceTimersByTimeAsync(5000);

        expect(socketService.emitToNamespaceRoom).toHaveBeenCalledWith(
          "/pdv",
          "pdv-sales-request:r1",
          "payment-receipt-analysis:done",
          expect.objectContaining({
            requestId: "r1",
            success: true,
            analysis: null,
          }),
        );
      } finally {
        jest.useRealTimers();
      }
    });

    it("erro inesperado (não relacionado à IA) na análise assíncrona notifica falha genérica", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (uploaderService.upload as jest.Mock).mockResolvedValue(
        "/pdv-receipts/r1/comprovante.png",
      );
      (pdvSalesRequestReceiptService.create as jest.Mock).mockResolvedValue({
        id: "receipt-1",
      });
      (pdvSalesRequestReceiptService.findById as jest.Mock).mockResolvedValue({
        id: "receipt-1",
      });
      (
        paymentReceiptExtractionService.analyze as jest.Mock
      ).mockResolvedValue({
        extraction: emptyReceiptExtraction,
        validated: null,
        fingerprint: null,
      });
      // Erro inesperado na hora de persistir a análise (não é falha da IA).
      (pdvSalesRequestReceiptService.update as jest.Mock).mockRejectedValue(
        new Error("banco fora do ar"),
      );

      await service.attachReceipt("r1", {
        buffer: Buffer.from(""),
        filename: "comprovante.png",
        mimeType: "image/png",
      });
      await flushAsync();

      expect(socketService.emitToNamespaceRoom).toHaveBeenCalledWith(
        "/pdv",
        "pdv-sales-request:r1",
        "payment-receipt-analysis:done",
        expect.objectContaining({
          requestId: "r1",
          success: false,
          reason: "ANALYSIS_UNAVAILABLE",
        }),
      );
    });

    it("descarta o resultado da análise se o comprovante foi removido antes dela terminar", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (uploaderService.upload as jest.Mock).mockResolvedValue(
        "/pdv-receipts/r1/comprovante.png",
      );
      (pdvSalesRequestReceiptService.create as jest.Mock).mockResolvedValue({
        id: "receipt-1",
      });
      // Linha já não existe mais quando a análise termina (removida
      // enquanto rodava) — job desiste sem gravar nem reconciliar.
      (pdvSalesRequestReceiptService.findById as jest.Mock).mockResolvedValue(
        null,
      );
      (
        paymentReceiptExtractionService.analyze as jest.Mock
      ).mockResolvedValue({
        extraction: { ...emptyReceiptExtraction, tipo_comprovante: "pix" },
        validated: null,
        fingerprint: "fingerprint-x",
      });

      await service.attachReceipt("r1", {
        buffer: Buffer.from(""),
        filename: "comprovante.png",
        mimeType: "image/png",
      });
      await flushAsync();

      expect(pdvSalesRequestReceiptService.update).not.toHaveBeenCalled();
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
      expect(socketService.emitToNamespaceRoom).not.toHaveBeenCalled();
    });
  });

  describe("deleteReceipt", () => {
    it("remove a linha, apaga o arquivo do uploader e reconcilia os que sobraram", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (pdvSalesRequestReceiptService.findById as jest.Mock).mockResolvedValue({
        id: "receipt-1",
        pdv_sales_request_id: "r1",
        path: "/pdv-receipts/r1/comprovante.png",
      });
      (
        pdvSalesRequestReceiptService.findAllByRequestId as jest.Mock
      ).mockResolvedValue([]);
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.deleteReceipt("r1", "receipt-1", "user-1");

      expect(pdvSalesRequestReceiptService.delete).toHaveBeenCalledWith(
        "receipt-1",
      );
      expect(uploaderService.delete).toHaveBeenCalledWith(
        "/pdv-receipts/r1/comprovante.png",
      );
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        payment_receipt_analysis: null,
        payment_receipt_validated: null,
        payment_method_matches_receipt: null,
        receipt_total_matches_order: null,
      });
      expect(pdvSalesRequestHistoryService.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Comprovante removido" }),
      );
    });

    it("recusa remover comprovante que não pertence a esta solicitação", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (pdvSalesRequestReceiptService.findById as jest.Mock).mockResolvedValue({
        id: "receipt-1",
        pdv_sales_request_id: "outra-solicitacao",
      });

      await expect(
        service.deleteReceipt("r1", "receipt-1"),
      ).rejects.toThrow(/não encontrado/);
      expect(pdvSalesRequestReceiptService.delete).not.toHaveBeenCalled();
    });
  });

  describe("confirmReceiptSubmission", () => {
    it("OPEN -> PENDING_FINANCE quando há ao menos 1 comprovante e tipo de envio definidos", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.OPEN,
        shipping_type: PdvShippingType.TRANSPORTADORA,
      });
      (
        pdvSalesRequestReceiptService.findAllByRequestId as jest.Mock
      ).mockResolvedValue([{ id: "receipt-1" }]);
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.confirmReceiptSubmission("r1");

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.PENDING_FINANCE },
        { transaction: mockTransaction },
      );
    });

    it("recusa confirmar sem nenhum comprovante anexado, mesmo com tipo de envio definido", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.OPEN,
        shipping_type: PdvShippingType.TRANSPORTADORA,
      });
      (
        pdvSalesRequestReceiptService.findAllByRequestId as jest.Mock
      ).mockResolvedValue([]);

      await expect(service.confirmReceiptSubmission("r1")).rejects.toThrow(
        /Anexe ao menos um comprovante/,
      );
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });

    it("recusa confirmar sem tipo de envio, mesmo com comprovante anexado", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.OPEN,
        shipping_type: null,
      });
      (
        pdvSalesRequestReceiptService.findAllByRequestId as jest.Mock
      ).mockResolvedValue([{ id: "receipt-1" }]);

      await expect(service.confirmReceiptSubmission("r1")).rejects.toThrow(
        /Anexe ao menos um comprovante/,
      );
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });

    it("PENDING_CORRECTION (origem financeiro) -> PENDING_FINANCE", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.PENDING_FINANCE,
        shipping_type: PdvShippingType.TRANSPORTADORA,
      });
      (
        pdvSalesRequestReceiptService.findAllByRequestId as jest.Mock
      ).mockResolvedValue([{ id: "receipt-1" }]);
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.confirmReceiptSubmission("r1");

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.PENDING_FINANCE },
        { transaction: mockTransaction },
      );
    });
  });

  describe("updateReceiptAnalysis", () => {
    it("mescla os campos enviados sobre a análise da linha, preserva o resto e reconcilia a solicitação", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
      });
      const currentAnalysis = {
        ...emptyReceiptExtraction,
        tipo_comprovante: "cartao_credito",
        instituicao_pagamento: "Laranjinha Itaú",
      };
      (pdvSalesRequestReceiptService.findById as jest.Mock).mockResolvedValue({
        id: "receipt-1",
        pdv_sales_request_id: "r1",
        analysis: currentAnalysis,
      });
      (
        paymentReceiptExtractionService.computeDerived as jest.Mock
      ).mockReturnValue({ validated: true, fingerprint: "fp-1" });
      (
        pdvSalesRequestReceiptService.findByFingerprint as jest.Mock
      ).mockResolvedValue(null);
      const mergedAnalysis = {
        ...currentAnalysis,
        instituicao_pagamento: "Itaú",
      };
      (
        pdvSalesRequestReceiptService.findAllByRequestId as jest.Mock
      ).mockResolvedValue([
        { id: "receipt-1", analysis: mergedAnalysis, validated: true },
      ]);
      (
        orderService.findByIdWithPaymentMethod as jest.Mock
      ).mockResolvedValue({ paymentMethod: { description: "Cartão de Crédito" } });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.updateReceiptAnalysis("r1", "receipt-1", {
        instituicao_pagamento: "Itaú",
      });

      expect(paymentReceiptExtractionService.computeDerived).toHaveBeenCalledWith(
        expect.objectContaining({
          tipo_comprovante: "cartao_credito",
          instituicao_pagamento: "Itaú",
        }),
      );
      expect(pdvSalesRequestReceiptService.update).toHaveBeenCalledWith(
        "receipt-1",
        {
          analysis: mergedAnalysis,
          validated: true,
          fingerprint: "fp-1",
        },
      );
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({
          payment_receipt_validated: true,
          payment_method_matches_receipt: true,
        }),
      );
      expect(pdvSalesRequestHistoryService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Análise do comprovante editada manualmente",
        }),
      );
    });

    it("recusa quando o comprovante não pertence a esta solicitação", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (pdvSalesRequestReceiptService.findById as jest.Mock).mockResolvedValue({
        id: "receipt-1",
        pdv_sales_request_id: "outra-solicitacao",
      });

      await expect(
        service.updateReceiptAnalysis("r1", "receipt-1", {
          instituicao_pagamento: "Itaú",
        }),
      ).rejects.toThrow(/não encontrado/);
      expect(pdvSalesRequestReceiptService.update).not.toHaveBeenCalled();
    });

    it("recusa editar fora da janela de edição (ex.: já em PENDING_FINANCE)", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_FINANCE,
      });

      await expect(
        service.updateReceiptAnalysis("r1", "receipt-1", {
          instituicao_pagamento: "Itaú",
        }),
      ).rejects.toThrow(/Ação inválida/);
      expect(pdvSalesRequestReceiptService.update).not.toHaveBeenCalled();
    });

    it("rejeita edição com tipo inválido (validação Zod)", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (pdvSalesRequestReceiptService.findById as jest.Mock).mockResolvedValue({
        id: "receipt-1",
        pdv_sales_request_id: "r1",
        analysis: null,
      });

      await expect(
        service.updateReceiptAnalysis("r1", "receipt-1", {
          valor_total: "não é número" as any,
        }),
      ).rejects.toThrow();
      expect(pdvSalesRequestReceiptService.update).not.toHaveBeenCalled();
    });

    it("recusa quando o fingerprint recalculado colide com OUTRO comprovante", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (pdvSalesRequestReceiptService.findById as jest.Mock).mockResolvedValue({
        id: "receipt-1",
        pdv_sales_request_id: "r1",
        analysis: emptyReceiptExtraction,
      });
      (
        paymentReceiptExtractionService.computeDerived as jest.Mock
      ).mockReturnValue({ validated: null, fingerprint: "fp-dup" });
      (
        pdvSalesRequestReceiptService.findByFingerprint as jest.Mock
      ).mockResolvedValue({ id: "outro-comprovante" });

      await expect(
        service.updateReceiptAnalysis("r1", "receipt-1", {
          estabelecimento_cnpj: "12345678000199",
        }),
      ).rejects.toThrow(/já foi utilizado em outra solicitação/);
      expect(pdvSalesRequestReceiptService.update).not.toHaveBeenCalled();
    });
  });

  describe("updatePaymentReceiptAnalysis", () => {
    it("mescla os campos enviados sobre o resumo conciliado atual e recalcula receipt_total_matches_order", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
        payment_receipt_analysis: {
          ...emptyReceiptExtraction,
          tipo_comprovante: "pix + cartao_credito",
          valor_total: 100,
        },
      });
      (orderService.findById as jest.Mock).mockResolvedValue({
        total_order: 120,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.updatePaymentReceiptAnalysis("r1", { valor_total: 120 });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        payment_receipt_analysis: expect.objectContaining({
          tipo_comprovante: "pix + cartao_credito",
          valor_total: 120,
        }),
        receipt_total_matches_order: true,
      });
      expect(pdvSalesRequestReceiptService.update).not.toHaveBeenCalled();
      expect(pdvSalesRequestHistoryService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Resumo do pagamento editado manualmente",
        }),
      );
    });

    it("parte de análise vazia quando payment_receipt_analysis ainda é null; sem total do pedido, fica null", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
        payment_receipt_analysis: null,
      });
      (orderService.findById as jest.Mock).mockResolvedValue({
        total_order: null,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.updatePaymentReceiptAnalysis("r1", {
        tipo_comprovante: "pix + cartao_credito",
        valor_total: 100,
      });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        payment_receipt_analysis: expect.objectContaining({
          tipo_comprovante: "pix + cartao_credito",
          valor_total: 100,
          estabelecimento_nome: null,
        }),
        receipt_total_matches_order: null,
      });
    });

    it("aceita tipo_comprovante como texto livre (mais de um tipo combinado)", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.OPEN,
        payment_receipt_analysis: null,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await expect(
        service.updatePaymentReceiptAnalysis("r1", {
          tipo_comprovante: "pix + cartao_credito",
        }),
      ).resolves.toBeDefined();
    });

    it("recusa editar fora da janela de edição (ex.: já em PENDING_FINANCE)", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_FINANCE,
      });

      await expect(
        service.updatePaymentReceiptAnalysis("r1", { valor_total: 100 }),
      ).rejects.toThrow(/Ação inválida/);
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });

    it("rejeita edição com tipo inválido (validação Zod)", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.OPEN,
        payment_receipt_analysis: null,
      });

      await expect(
        service.updatePaymentReceiptAnalysis("r1", {
          valor_total: "não é número" as any,
        }),
      ).rejects.toThrow();
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });
  });

  describe("attachTransferInvoice", () => {
    it("vincula direto quando o front já manda o invoiceId resolvido pela busca — NÃO avança pra SHIPPING", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.PENDING_NF_TRANSFER,
        transfer_invoice_id: null,
      });
      (getTCarIntegration as jest.Mock).mockResolvedValue({ id: "tecinco-1" });
      (invoiceService.findById as jest.Mock).mockResolvedValue({
        id: "invoice-transfer",
        integrations_id: "tecinco-1",
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.attachTransferInvoice("r1", {
        invoiceId: "invoice-transfer",
        tcarUpsertQueue: {} as any,
      });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        transfer_invoice_id: "invoice-transfer",
      });
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({ status: expect.anything() }),
        expect.anything(),
      );
      expect(pdvSalesRequestHistoryService.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Nota de transferência vinculada" }),
      );
    });

    it("permite editar a nota de transferência já em SHIPPING (troca, nunca fica nulo)", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.SHIPPING,
        transfer_invoice_id: "invoice-antiga",
      });
      (getTCarIntegration as jest.Mock).mockResolvedValue({ id: "tecinco-1" });
      (invoiceService.findById as jest.Mock).mockResolvedValue({
        id: "invoice-nova",
        integrations_id: "tecinco-1",
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.attachTransferInvoice("r1", {
        invoiceId: "invoice-nova",
        tcarUpsertQueue: {} as any,
      });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        transfer_invoice_id: "invoice-nova",
      });
      expect(pdvSalesRequestHistoryService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          description: "Nota de transferência substituída",
        }),
      );
    });

    it("recusa quando a nota informada não é da integração Tecinco", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.PENDING_NF_TRANSFER,
      });
      (getTCarIntegration as jest.Mock).mockResolvedValue({ id: "tecinco-1" });
      (invoiceService.findById as jest.Mock).mockResolvedValue({
        id: "invoice-sale",
        integrations_id: "bling-1",
      });

      await expect(
        service.attachTransferInvoice("r1", {
          invoiceId: "invoice-sale",
          tcarUpsertQueue: {} as any,
        }),
      ).rejects.toThrow(/Tecinco/);
    });

    it("sem invoiceId/xml/danfe: recusa pedindo um deles", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.PENDING_NF_TRANSFER,
      });
      (getTCarIntegration as jest.Mock).mockResolvedValue({ id: "tecinco-1" });

      await expect(
        service.attachTransferInvoice("r1", { tcarUpsertQueue: {} as any }),
      ).rejects.toThrow(/Informe o id/);
    });

    it("permite trocar em FINISHED quando o romaneio da nota de venda ainda não foi gerado", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.FINISHED,
        sale_invoice_id: "invoice-sale",
        transfer_invoice_id: "invoice-antiga",
      });
      (getTCarIntegration as jest.Mock).mockResolvedValue({ id: "tecinco-1" });
      (unitBusinessService.getCd21UnitBusiness as jest.Mock).mockResolvedValue({
        id: "cd21-1",
      });
      (
        invoiceService.findDeliveryNoteGeneratedInvoiceIds as jest.Mock
      ).mockResolvedValue([]);
      (invoiceService.findById as jest.Mock).mockResolvedValue({
        id: "invoice-nova",
        integrations_id: "tecinco-1",
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.attachTransferInvoice("r1", {
        invoiceId: "invoice-nova",
        tcarUpsertQueue: {} as any,
      });

      expect(
        invoiceService.findDeliveryNoteGeneratedInvoiceIds,
      ).toHaveBeenCalledWith(["invoice-sale"], "cd21-1");
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        transfer_invoice_id: "invoice-nova",
      });
    });

    it("recusa trocar em SHIPPING/FINISHED quando o romaneio da nota de venda já foi gerado", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.SHIPPING,
        sale_invoice_id: "invoice-sale",
        transfer_invoice_id: "invoice-antiga",
      });
      (getTCarIntegration as jest.Mock).mockResolvedValue({ id: "tecinco-1" });
      (unitBusinessService.getCd21UnitBusiness as jest.Mock).mockResolvedValue({
        id: "cd21-1",
      });
      (
        invoiceService.findDeliveryNoteGeneratedInvoiceIds as jest.Mock
      ).mockResolvedValue(["invoice-sale"]);

      await expect(
        service.attachTransferInvoice("r1", {
          invoiceId: "invoice-nova",
          tcarUpsertQueue: {} as any,
        }),
      ).rejects.toThrow(/romaneio da nota de venda já foi gerado/);
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });
  });

  describe("confirmTransferInvoice", () => {
    it("PENDING_NF_TRANSFER -> SHIPPING quando já há uma nota vinculada", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_NF_TRANSFER,
        transfer_invoice_id: "invoice-transfer",
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.confirmTransferInvoice("r1");

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.SHIPPING },
        { transaction: mockTransaction },
      );
    });

    it("recusa confirmar sem nenhuma nota de transferência vinculada ainda", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_NF_TRANSFER,
        transfer_invoice_id: null,
      });

      await expect(service.confirmTransferInvoice("r1")).rejects.toThrow(
        /Vincule uma nota/,
      );
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });

    it("recusa quando a solicitação já está em SHIPPING (nada a confirmar)", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.SHIPPING,
        transfer_invoice_id: "invoice-transfer",
      });

      await expect(service.confirmTransferInvoice("r1")).rejects.toThrow(
        /Ação inválida/,
      );
    });
  });

  describe("canEditTransferInvoice", () => {
    it("recusa se a solicitação não existe", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.canEditTransferInvoice("r1"),
      ).rejects.toThrow(/não encontrada/);
    });

    it.each([
      PdvSalesRequestStatus.OPEN,
      PdvSalesRequestStatus.PENDING_FINANCE,
      PdvSalesRequestStatus.PENDING_CD21_ANALYSIS,
      PdvSalesRequestStatus.PENDING_NF_SALE,
      PdvSalesRequestStatus.CANCELLED,
    ])("false quando o status é %s (fora do fluxo de nota de transferência)", async (status) => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status,
        sale_invoice_id: null,
      });

      await expect(service.canEditTransferInvoice("r1")).resolves.toBe(false);
      expect(unitBusinessService.getCd21UnitBusiness).not.toHaveBeenCalled();
    });

    it("true em PENDING_NF_TRANSFER mesmo sem sale_invoice_id (nunca tem romaneio possível ainda)", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_NF_TRANSFER,
        sale_invoice_id: null,
      });

      await expect(service.canEditTransferInvoice("r1")).resolves.toBe(true);
    });

    it("true em SHIPPING/FINISHED quando o romaneio da nota de venda ainda não foi gerado", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.FINISHED,
        sale_invoice_id: "invoice-sale",
      });
      (unitBusinessService.getCd21UnitBusiness as jest.Mock).mockResolvedValue({
        id: "cd21-1",
      });
      (
        invoiceService.findDeliveryNoteGeneratedInvoiceIds as jest.Mock
      ).mockResolvedValue([]);

      await expect(service.canEditTransferInvoice("r1")).resolves.toBe(true);
    });

    it("false em SHIPPING/FINISHED quando o romaneio da nota de venda já foi gerado", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.SHIPPING,
        sale_invoice_id: "invoice-sale",
      });
      (unitBusinessService.getCd21UnitBusiness as jest.Mock).mockResolvedValue({
        id: "cd21-1",
      });
      (
        invoiceService.findDeliveryNoteGeneratedInvoiceIds as jest.Mock
      ).mockResolvedValue(["invoice-sale"]);

      await expect(service.canEditTransferInvoice("r1")).resolves.toBe(false);
    });
  });

  // ─── handleInvoiceCancelled ─────────────────────────────────────────────────

  describe("handleInvoiceCancelled", () => {
    it("move pra INVOICE_CANCELLED toda solicitação ativa que referencia a nota, seja como venda ou transferência", async () => {
      (
        pdvSalesRequestRepository.findActiveBySaleOrTransferInvoiceId as jest.Mock
      ).mockResolvedValue([
        {
          id: "r-sale",
          sale_invoice_id: "invoice-x",
          transfer_invoice_id: null,
        },
        {
          id: "r-transfer",
          sale_invoice_id: null,
          transfer_invoice_id: "invoice-x",
        },
      ]);
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({});

      await service.handleInvoiceCancelled("invoice-x");

      expect(
        pdvSalesRequestRepository.findActiveBySaleOrTransferInvoiceId,
      ).toHaveBeenCalledWith("invoice-x");
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r-sale",
        { status: PdvSalesRequestStatus.INVOICE_CANCELLED },
        { transaction: mockTransaction },
      );
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r-transfer",
        { status: PdvSalesRequestStatus.INVOICE_CANCELLED },
        { transaction: mockTransaction },
      );
      expect(pdvSalesRequestHistoryService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pdv_sales_request_id: "r-transfer",
          description: expect.stringContaining("transferência"),
        }),
        { transaction: mockTransaction },
      );
    });

    it("solicitação já FINISHED/CANCELLED não é afetada (o repository já filtra por status ativo)", async () => {
      (
        pdvSalesRequestRepository.findActiveBySaleOrTransferInvoiceId as jest.Mock
      ).mockResolvedValue([]);

      await service.handleInvoiceCancelled("invoice-x");

      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });
  });

  describe("cd21ResolveInvoiceCancelled", () => {
    it("RETRY_ANALYSIS: zera sale/transfer invoice e volta pra PENDING_CD21_ANALYSIS", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.INVOICE_CANCELLED,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.cd21ResolveInvoiceCancelled("r1", {
        decision: "RETRY_ANALYSIS",
      });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        sale_invoice_id: null,
        transfer_invoice_id: null,
      });
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.PENDING_CD21_ANALYSIS },
        { transaction: mockTransaction },
      );
    });

    it("REQUEST_CORRECTION: grava origem INVOICE_CANCELLED e vai pra PENDING_CORRECTION", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.INVOICE_CANCELLED,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.cd21ResolveInvoiceCancelled("r1", {
        decision: "REQUEST_CORRECTION",
      });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        correction_origin_status: PdvSalesRequestStatus.INVOICE_CANCELLED,
        errors: {
          origin: PdvCorrectionOrigin.INVOICE_CANCELLED,
          reasons: [PdvCorrectionReason.INVOICE_CANCELLED],
          note: "Nota fiscal cancelada",
        },
      });
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.PENDING_CORRECTION },
        { transaction: mockTransaction },
      );
    });

    it("recusa quando a solicitação não está em INVOICE_CANCELLED", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CD21_ANALYSIS,
      });

      await expect(
        service.cd21ResolveInvoiceCancelled("r1", {
          decision: "RETRY_ANALYSIS",
        }),
      ).rejects.toThrow(/Ação inválida/);
    });
  });

  describe("resolveCorrection — origem INVOICE_CANCELLED", () => {
    it("decision CANCEL: vai pra CANCELLED", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.INVOICE_CANCELLED,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.resolveCorrection("r1", { decision: "CANCEL" });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.CANCELLED },
        { transaction: mockTransaction },
      );
    });

    it("decision RETRY_ANALYSIS: zera invoices e volta pra PENDING_CD21_ANALYSIS", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.INVOICE_CANCELLED,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.resolveCorrection("r1", { decision: "RETRY_ANALYSIS" });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        sale_invoice_id: null,
        transfer_invoice_id: null,
      });
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.PENDING_CD21_ANALYSIS },
        { transaction: mockTransaction },
      );
    });

    it("sem decision válida: recusa", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.INVOICE_CANCELLED,
      });

      await expect(service.resolveCorrection("r1", {})).rejects.toThrow(
        /CANCEL ou RETRY_ANALYSIS/,
      );
    });
  });

  describe("finishIfDeliveryNoteGenerated", () => {
    beforeEach(() => {
      (
        unitBusinessService.getCd21UnitBusiness as jest.Mock
      ).mockResolvedValue({ id: "cd21-id" });
    });

    it("TRANSPORTADORA: finaliza assim que a nota de venda entra num romaneio DO CD21", async () => {
      (
        pdvSalesRequestRepository.findShippingBySaleOrTransferInvoiceIds as jest.Mock
      ).mockResolvedValue([
        {
          id: "r1",
          sale_invoice_id: "invoice-sale",
          transfer_invoice_id: null,
          shipping_type: PdvShippingType.TRANSPORTADORA,
        },
      ]);
      (
        invoiceService.findDeliveryNoteGeneratedInvoiceIds as jest.Mock
      ).mockResolvedValue(["invoice-sale"]);
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.SHIPPING,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.finishIfDeliveryNoteGenerated(["invoice-sale"]);

      expect(
        invoiceService.findDeliveryNoteGeneratedInvoiceIds,
      ).toHaveBeenCalledWith(["invoice-sale"], "cd21-id");
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.FINISHED },
        { transaction: mockTransaction },
      );
    });

    it("ADT: finaliza só com a nota de venda com romaneio, mesmo com a de transferência pendente", async () => {
      (
        pdvSalesRequestRepository.findShippingBySaleOrTransferInvoiceIds as jest.Mock
      ).mockResolvedValue([
        {
          id: "r1",
          sale_invoice_id: "invoice-sale",
          transfer_invoice_id: "invoice-transfer",
          shipping_type: PdvShippingType.ADT,
        },
      ]);
      (
        invoiceService.findDeliveryNoteGeneratedInvoiceIds as jest.Mock
      ).mockResolvedValue(["invoice-sale"]);
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.SHIPPING,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.finishIfDeliveryNoteGenerated(["invoice-sale"]);

      // Nem consulta romaneio da nota de transferência — só a de venda importa.
      expect(
        invoiceService.findDeliveryNoteGeneratedInvoiceIds,
      ).toHaveBeenCalledWith(["invoice-sale"], "cd21-id");
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.FINISHED },
        { transaction: mockTransaction },
      );
    });

    it("ADT: NÃO finaliza enquanto a nota de venda ainda não tem romaneio gerado", async () => {
      (
        pdvSalesRequestRepository.findShippingBySaleOrTransferInvoiceIds as jest.Mock
      ).mockResolvedValue([
        {
          id: "r1",
          sale_invoice_id: "invoice-sale",
          transfer_invoice_id: "invoice-transfer",
          shipping_type: PdvShippingType.ADT,
        },
      ]);
      (
        invoiceService.findDeliveryNoteGeneratedInvoiceIds as jest.Mock
      ).mockResolvedValue([]);

      await service.finishIfDeliveryNoteGenerated(["invoice-transfer"]);

      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });

    it("sem solicitação SHIPPING candidata: não consulta CD21 nem romaneio", async () => {
      (
        pdvSalesRequestRepository.findShippingBySaleOrTransferInvoiceIds as jest.Mock
      ).mockResolvedValue([]);

      await service.finishIfDeliveryNoteGenerated(["invoice-x"]);

      expect(unitBusinessService.getCd21UnitBusiness).not.toHaveBeenCalled();
      expect(
        invoiceService.findDeliveryNoteGeneratedInvoiceIds,
      ).not.toHaveBeenCalled();
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });

    it("CD21 não cadastrado: recusa em vez de checar romaneio sem escopo", async () => {
      (
        pdvSalesRequestRepository.findShippingBySaleOrTransferInvoiceIds as jest.Mock
      ).mockResolvedValue([
        {
          id: "r1",
          sale_invoice_id: "invoice-sale",
          transfer_invoice_id: null,
          shipping_type: PdvShippingType.TRANSPORTADORA,
        },
      ]);
      (unitBusinessService.getCd21UnitBusiness as jest.Mock).mockResolvedValue(
        null,
      );

      await expect(
        service.finishIfDeliveryNoteGenerated(["invoice-sale"]),
      ).rejects.toThrow(/CD21/);
      expect(
        invoiceService.findDeliveryNoteGeneratedInvoiceIds,
      ).not.toHaveBeenCalled();
    });
  });

  describe("cancelIfActiveByOrderId", () => {
    it("cancela a solicitação ativa do pedido", async () => {
      (pdvSalesRequestRepository.findActiveByOrderId as jest.Mock).mockResolvedValue(
        { id: "r1" },
      );
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.cancelIfActiveByOrderId("order-1");

      expect(pdvSalesRequestRepository.findActiveByOrderId).toHaveBeenCalledWith(
        "order-1",
      );
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.CANCELLED },
        { transaction: mockTransaction },
      );
    });

    it("sem solicitação ativa pro pedido: não faz nada", async () => {
      (pdvSalesRequestRepository.findActiveByOrderId as jest.Mock).mockResolvedValue(
        null,
      );

      await service.cancelIfActiveByOrderId("order-1");

      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });
  });

  describe("correctFinishedRequest", () => {
    it("RESET_INVOICES: zera as duas notas e volta pra PENDING_NF_SALE", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.FINISHED,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.correctFinishedRequest("r1", {
        decision: "RESET_INVOICES",
      });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        sale_invoice_id: null,
        transfer_invoice_id: null,
      });
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.PENDING_NF_SALE },
        { transaction: mockTransaction },
      );
    });

    it("REQUEST_CORRECTION: grava origem FINISHED com o motivo e vai pra PENDING_CORRECTION", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.FINISHED,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.correctFinishedRequest("r1", {
        decision: "REQUEST_CORRECTION",
        note: "Cliente pediu troca de item após entrega",
      });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        correction_origin_status: PdvSalesRequestStatus.FINISHED,
        errors: {
          origin: PdvCorrectionOrigin.FINISHED,
          reasons: [PdvCorrectionReason.OTHER_INFO],
          note: "Cliente pediu troca de item após entrega",
        },
      });
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.PENDING_CORRECTION },
        { transaction: mockTransaction },
      );
    });

    it("REQUEST_CORRECTION sem note: recusa", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.FINISHED,
      });

      await expect(
        service.correctFinishedRequest("r1", {
          decision: "REQUEST_CORRECTION",
        }),
      ).rejects.toThrow(/motivo da correção/);
    });

    it("recusa quando a solicitação não está FINISHED", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.SHIPPING,
      });

      await expect(
        service.correctFinishedRequest("r1", { decision: "RESET_INVOICES" }),
      ).rejects.toThrow(/Ação inválida/);
    });
  });

  describe("resolveCorrection — origem FINISHED", () => {
    it("confirma e volta direto pra FINISHED (não passa por SHIPPING de novo)", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.FINISHED,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.resolveCorrection("r1", {});

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.FINISHED },
        { transaction: mockTransaction },
      );
    });
  });
});
