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
  default: { findById: jest.fn() },
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
  default: { upload: jest.fn() },
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

import pdvSalesRequestRepository from "../pdv-sales-request.repository";
import pdvSalesRequestHistoryService from "../../sales-request-history/pdv-sales-request-history.service";
import orderService from "../../../orders/order/orders.service";
import invoiceService from "../../../../warehouse/fiscal/invoices/invoice/invoice.service";
import { getTCarIntegration } from "../../../../handlers/tecinco/api/tecinco_api";
import { PdvSalesRequestService } from "../pdv-sales-request.service";
import {
  PdvCorrectionOrigin,
  PdvCorrectionReason,
  PdvSalesRequestStatus,
  PdvShippingType,
} from "../pdv-sales-request.types";

const mockTransaction = {} as any;

describe("PdvSalesRequestService", () => {
  let service: PdvSalesRequestService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PdvSalesRequestService();
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
    it("origem PENDING_FINANCE: volta pra PENDING_FINANCE", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        status: PdvSalesRequestStatus.PENDING_CORRECTION,
        correction_origin_status: PdvSalesRequestStatus.PENDING_FINANCE,
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.resolveCorrection("r1", {});

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.PENDING_FINANCE },
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

  describe("markSaleInvoiceReady", () => {
    it("envio ADT: vai pra PENDING_NF_TRANSFER", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.PENDING_NF_SALE,
        shipping_type: PdvShippingType.ADT,
        sale_invoice_id: "invoice-1",
      });
      (orderService.findById as jest.Mock).mockResolvedValue({
        invoice_id: "invoice-1",
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.markSaleInvoiceReady("r1");

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.PENDING_NF_TRANSFER },
        { transaction: mockTransaction },
      );
    });

    it("envio TRANSPORTADORA: vai direto pra SHIPPING", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.PENDING_NF_SALE,
        shipping_type: PdvShippingType.TRANSPORTADORA,
        sale_invoice_id: "invoice-1",
      });
      (orderService.findById as jest.Mock).mockResolvedValue({
        invoice_id: "invoice-1",
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.markSaleInvoiceReady("r1");

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.SHIPPING },
        { transaction: mockTransaction },
      );
    });

    it("re-sincroniza sale_invoice_id quando order.invoice_id mudou desde a criação", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.PENDING_NF_SALE,
        shipping_type: PdvShippingType.TRANSPORTADORA,
        sale_invoice_id: "invoice-old",
      });
      (orderService.findById as jest.Mock).mockResolvedValue({
        invoice_id: "invoice-new",
      });
      (pdvSalesRequestRepository.update as jest.Mock).mockResolvedValue({
        id: "r1",
      });

      await service.markSaleInvoiceReady("r1");

      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith("r1", {
        sale_invoice_id: "invoice-new",
      });
    });
  });

  describe("attachTransferInvoice", () => {
    it("vincula direto quando o front já manda o invoiceId resolvido pela busca", async () => {
      (pdvSalesRequestRepository.findById as jest.Mock).mockResolvedValue({
        id: "r1",
        order_id: "order-1",
        status: PdvSalesRequestStatus.PENDING_NF_TRANSFER,
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
      expect(pdvSalesRequestRepository.update).toHaveBeenCalledWith(
        "r1",
        { status: PdvSalesRequestStatus.SHIPPING },
        { transaction: mockTransaction },
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
});
