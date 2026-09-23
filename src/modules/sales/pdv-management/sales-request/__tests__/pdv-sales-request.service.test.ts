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
    findByReceiptFingerprint: jest.fn(),
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
  default: { findById: jest.fn(), findByIdWithPaymentMethod: jest.fn() },
}));

jest.mock("../../../../warehouse/fiscal/invoices/invoice/invoice.service", () => ({
  __esModule: true,
  default: { findById: jest.fn(), findOne: jest.fn(), findAll: jest.fn() },
}));

jest.mock("../../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
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
  default: { analyze: jest.fn() },
}));

import pdvSalesRequestRepository from "../pdv-sales-request.repository";
import pdvSalesRequestHistoryService from "../../sales-request-history/pdv-sales-request-history.service";
import orderService from "../../../orders/order/orders.service";
import invoiceService from "../../../../warehouse/fiscal/invoices/invoice/invoice.service";
import uploaderService from "../../../../handlers/uploader/services/uploader.service";
import { getTCarIntegration } from "../../../../handlers/tecinco/api/tecinco_api";
import nfeEmissionService from "../../../../handlers/bling/services/bling-nfe/nfe-emission.service";
import paymentReceiptExtractionService from "../payment-receipt-extraction.service";
import { PdvSalesRequestService } from "../pdv-sales-request.service";
import {
  PdvCorrectionOrigin,
  PdvCorrectionReason,
  PdvSalesRequestStatus,
  PdvShippingType,
} from "../pdv-sales-request.types";

const mockTransaction = {} as any;

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

  describe("attachReceiptAndShippingType", () => {
    it("salva comprovante+tipo de envio mas NÃO avança status (front confirma depois)", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.OPEN,
        payment_receipt_path: null,
      });
      (uploaderService.upload as jest.Mock).mockResolvedValue(
        "/pdv-receipts/comprovante.png",
      );
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.OPEN,
      });

      await service.attachReceiptAndShippingType("r1", {
        buffer: Buffer.from(""),
        filename: "comprovante.png",
        mimeType: "image/png",
        shippingType: PdvShippingType.TRANSPORTADORA,
      });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({
          payment_receipt_path: "/pdv-receipts/comprovante.png",
          shipping_type: PdvShippingType.TRANSPORTADORA,
        }),
      );
      // Sem transação/transitionTo — status não muda.
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalledWith(
        "r1",
        expect.objectContaining({ status: expect.anything() }),
        expect.anything(),
      );
      expect(uploaderService.delete).not.toHaveBeenCalled();
      expect(pdvSalesRequestHistoryService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          pdv_sales_request_id: "r1",
          step: PdvSalesRequestStatus.OPEN,
          description: expect.stringContaining("anexados"),
        }),
      );
    });

    it("editar um comprovante já existente apaga o antigo do uploader depois de salvar o novo", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.PENDING_FINANCE,
        payment_receipt_path: "/pdv-receipts/antigo.png",
      });
      (uploaderService.upload as jest.Mock).mockResolvedValue(
        "/pdv-receipts/novo.png",
      );
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.attachReceiptAndShippingType("r1", {
        buffer: Buffer.from(""),
        filename: "novo.png",
        mimeType: "image/png",
        shippingType: PdvShippingType.TRANSPORTADORA,
      });

      expect(uploaderService.delete).toHaveBeenCalledWith(
        "/pdv-receipts/antigo.png",
      );
      expect(pdvSalesRequestHistoryService.create).toHaveBeenCalledWith(
        expect.objectContaining({ description: "Comprovante substituído" }),
      );
    });

    it("recusa anexar comprovante quando a correção pendente não é de financeiro", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.PENDING_CD21_ANALYSIS,
      });

      await expect(
        service.attachReceiptAndShippingType("r1", {
          buffer: Buffer.from(""),
          filename: "novo.png",
          mimeType: "image/png",
          shippingType: PdvShippingType.TRANSPORTADORA,
        }),
      ).rejects.toThrow(/endpoint de correção/);
      expect(uploaderService.upload).not.toHaveBeenCalled();
    });

    it("persiste a análise da IA (extração, validação matemática, fingerprint, match de forma de pagamento)", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (uploaderService.upload as jest.Mock).mockResolvedValue(
        "/pdv-receipts/comprovante.png",
      );
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });
      (
        paymentReceiptExtractionService.analyze as jest.Mock
      ).mockResolvedValue({
        extraction: {
          ...emptyReceiptExtraction,
          tipo_comprovante: "pix",
        },
        validated: null,
        fingerprint: "fingerprint-1",
      });
      (
        orderService.findByIdWithPaymentMethod as jest.Mock
      ).mockResolvedValue({
        paymentMethod: { description: "Pix" },
      });

      await service.attachReceiptAndShippingType("r1", {
        buffer: Buffer.from(""),
        filename: "comprovante.png",
        mimeType: "image/png",
        shippingType: PdvShippingType.TRANSPORTADORA,
      });

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        payment_receipt_path: "/pdv-receipts/comprovante.png",
        shipping_type: PdvShippingType.TRANSPORTADORA,
        payment_receipt_analysis: {
          ...emptyReceiptExtraction,
          tipo_comprovante: "pix",
        },
        payment_receipt_validated: null,
        payment_receipt_fingerprint: "fingerprint-1",
        payment_method_matches_receipt: true,
      });
    });

    it("recusa quando o fingerprint já existe em outra solicitação, sem subir o arquivo", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (
        paymentReceiptExtractionService.analyze as jest.Mock
      ).mockResolvedValue({
        extraction: emptyReceiptExtraction,
        validated: null,
        fingerprint: "fingerprint-dup",
      });
      (
        pdvSalesRequestRepository.findByReceiptFingerprint as jest.Mock
      ).mockResolvedValue({ id: "outra-solicitacao" });

      await expect(
        service.attachReceiptAndShippingType("r1", {
          buffer: Buffer.from(""),
          filename: "comprovante.png",
          mimeType: "image/png",
          shippingType: PdvShippingType.TRANSPORTADORA,
        }),
      ).rejects.toThrow(/já foi utilizado em outra solicitação/);
      expect(uploaderService.upload).not.toHaveBeenCalled();
    });

    it("mesmo fingerprint na PRÓPRIA solicitação (reenvio) não é tratado como duplicidade", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (uploaderService.upload as jest.Mock).mockResolvedValue(
        "/pdv-receipts/comprovante.png",
      );
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });
      (
        paymentReceiptExtractionService.analyze as jest.Mock
      ).mockResolvedValue({
        extraction: emptyReceiptExtraction,
        validated: null,
        fingerprint: "fingerprint-same",
      });
      (
        pdvSalesRequestRepository.findByReceiptFingerprint as jest.Mock
      ).mockResolvedValue({ id: "r1" });

      await expect(
        service.attachReceiptAndShippingType("r1", {
          buffer: Buffer.from(""),
          filename: "comprovante.png",
          mimeType: "image/png",
          shippingType: PdvShippingType.TRANSPORTADORA,
        }),
      ).resolves.toBeDefined();
      expect(uploaderService.upload).toHaveBeenCalled();
    });

    it("falha da IA (Gemini fora do ar) não bloqueia o anexo — segue com análise nula", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.OPEN,
      });
      (uploaderService.upload as jest.Mock).mockResolvedValue(
        "/pdv-receipts/comprovante.png",
      );
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });
      (paymentReceiptExtractionService.analyze as jest.Mock).mockRejectedValue(
        new Error("Gemini indisponível"),
      );

      await service.attachReceiptAndShippingType("r1", {
        buffer: Buffer.from(""),
        filename: "comprovante.png",
        mimeType: "image/png",
        shippingType: PdvShippingType.TRANSPORTADORA,
      });

      expect(uploaderService.upload).toHaveBeenCalled();
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        payment_receipt_path: "/pdv-receipts/comprovante.png",
        shipping_type: PdvShippingType.TRANSPORTADORA,
        payment_receipt_analysis: null,
        payment_receipt_validated: null,
        payment_receipt_fingerprint: null,
        payment_method_matches_receipt: null,
      });
    });
  });

  describe("confirmReceiptSubmission", () => {
    it("OPEN -> PENDING_FINANCE quando comprovante e tipo de envio já foram anexados", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.OPEN,
        payment_receipt_path: "/pdv-receipts/comprovante.png",
        shipping_type: PdvShippingType.TRANSPORTADORA,
      });
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

    it("recusa confirmar sem comprovante ou sem tipo de envio anexado ainda", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.OPEN,
        payment_receipt_path: null,
        shipping_type: null,
      });

      await expect(service.confirmReceiptSubmission("r1")).rejects.toThrow(
        /Anexe o comprovante/,
      );
      expect(pdvSalesRequestRepository.update).not.toHaveBeenCalled();
    });

    it("PENDING_CORRECTION (origem financeiro) -> PENDING_FINANCE", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.PENDING_FINANCE,
        payment_receipt_path: "/pdv-receipts/novo.png",
        shipping_type: PdvShippingType.TRANSPORTADORA,
      });
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
});
