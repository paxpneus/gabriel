jest.mock("../../orders.service", () => ({
  __esModule: true,
  default: { findOne: jest.fn(), update: jest.fn() },
}));

jest.mock(
  "../../../../pdv-management/sales-request/pdv-sales-request.service",
  () => ({
    __esModule: true,
    default: { cancelIfActiveByOrderId: jest.fn() },
  }),
);

jest.mock(
  "../../../../../handlers/bling/services/bling/helpers/get-with-sleep",
  () => ({
    __esModule: true,
    blingGet: jest.fn(),
    blingPatch: jest.fn(),
  }),
);

import ordersService from "../../orders.service";
import {
  blingGet,
  blingPatch,
} from "../../../../../handlers/bling/services/bling/helpers/get-with-sleep";
import pdvSalesRequestService from "../../../../pdv-management/sales-request/pdv-sales-request.service";
import { escalateToHumanVerificationIfStillPending } from "../order-status";
import {
  OrderInternalStatus,
  OrderReasonCancelled,
} from "../../orders.types";

const HUMAN_VERIFICATION_URL = "/pedidos/vendas/1001/situacoes/748772";

function mockLiveSituacao(situacaoId: number, extra: any = {}) {
  (blingGet as jest.Mock).mockResolvedValue({
    data: { data: { situacao: { id: situacaoId }, ...extra } },
  });
}

describe("escalateToHumanVerificationIfStillPending", () => {
  const blingApi = {} as any;

  beforeEach(() => {
    jest.clearAllMocks();
    (ordersService.findOne as jest.Mock).mockResolvedValue({ id: "o1" });
    (ordersService.update as jest.Mock).mockResolvedValue([1]);
    (blingPatch as jest.Mock).mockResolvedValue({ data: {} });
  });

  it("situação ao vivo já é terminal (EMITTED, ex: 'Atendido'): não escala, só sincroniza", async () => {
    mockLiveSituacao(9); // Atendido -> EMITTED

    const result = await escalateToHumanVerificationIfStillPending({
      idOrderSystem: 1001,
      blingApi,
      allowedPendingStatuses: [OrderInternalStatus.OPEN],
      reasonCancelled: OrderReasonCancelled.DOCUMENT_INVALID,
    });

    expect(result).toEqual({
      escalated: false,
      reason: "already-terminal",
      internalStatus: OrderInternalStatus.EMITTED,
    });
    expect(blingPatch).not.toHaveBeenCalled();
    expect(ordersService.update).toHaveBeenCalledWith("o1", {
      nfe_emitted: true,
      internal_status: OrderInternalStatus.EMITTED,
    });
  });

  it.each([
    [834029, OrderInternalStatus.SENT_TO_TRANSPORTER],
    [834030, OrderInternalStatus.DELIVERED],
  ])(
    "situação ao vivo %i (%s) também é terminal: não escala",
    async (situacaoId, expectedStatus) => {
      mockLiveSituacao(situacaoId);

      const result = await escalateToHumanVerificationIfStillPending({
        idOrderSystem: 1001,
        blingApi,
        allowedPendingStatuses: [OrderInternalStatus.WAITING_CHANNEL_VALIDATION],
        reasonCancelled: OrderReasonCancelled.ML_SCRAPING_NO_MATCH,
      });

      expect(result.escalated).toBe(false);
      expect(blingPatch).not.toHaveBeenCalled();
      expect(ordersService.update).toHaveBeenCalledWith("o1", {
        nfe_emitted: true,
        internal_status: expectedStatus,
      });
    },
  );

  it("situação ao vivo já é CANCELLED (ex: cancelado pelo cliente): não escala por cima de um cancelamento já existente", async () => {
    mockLiveSituacao(12);

    const result = await escalateToHumanVerificationIfStillPending({
      idOrderSystem: 1001,
      blingApi,
      allowedPendingStatuses: [OrderInternalStatus.OPEN],
      reasonCancelled: OrderReasonCancelled.DOCUMENT_INVALID,
    });

    expect(result).toEqual({
      escalated: false,
      reason: "already-terminal",
      internalStatus: OrderInternalStatus.CANCELLED,
    });
    expect(blingPatch).not.toHaveBeenCalled();
    // Sem reasonCancelled: escalateToHumanVerificationIfStillPending não sabe
    // por que já estava cancelado, então não inventa um motivo.
    expect(ordersService.update).toHaveBeenCalledWith("o1", {
      nfe_emitted: false,
      internal_status: OrderInternalStatus.CANCELLED,
    });
  });

  it("situação ao vivo bate com allowedPendingStatuses: roda beforeEscalate ANTES do PATCH, depois escala e grava CANCELLED/nfe_emitted=false/reason_cancelled", async () => {
    mockLiveSituacao(6, { observacoesInternas: "nota antiga" }); // OPEN
    const callOrder: string[] = [];
    (blingPatch as jest.Mock).mockImplementation(async () => {
      callOrder.push("patch");
      return { data: {} };
    });
    const beforeEscalate = jest.fn(async (liveOrderData: any) => {
      callOrder.push("beforeEscalate");
      expect(liveOrderData.observacoesInternas).toBe("nota antiga");
    });

    const result = await escalateToHumanVerificationIfStillPending({
      idOrderSystem: 1001,
      blingApi,
      allowedPendingStatuses: [OrderInternalStatus.OPEN],
      reasonCancelled: OrderReasonCancelled.DOCUMENT_INVALID,
      beforeEscalate,
    });

    expect(result).toEqual({ escalated: true });
    expect(callOrder).toEqual(["beforeEscalate", "patch"]);
    expect(blingPatch).toHaveBeenCalledWith(
      HUMAN_VERIFICATION_URL,
      { id: 748772 },
      blingApi,
    );
    expect(ordersService.update).toHaveBeenCalledWith("o1", {
      internal_status: OrderInternalStatus.CANCELLED,
      nfe_emitted: false,
      reason_cancelled: OrderReasonCancelled.DOCUMENT_INVALID,
    });
    // Verificação humana grava internal_status=CANCELLED só como estado
    // interno nosso — não é "pedido cancelado" pra Bling, então não deve
    // cancelar (nem mudar o status de) uma PdvSalesRequest ativa.
    expect(
      pdvSalesRequestService.cancelIfActiveByOrderId,
    ).not.toHaveBeenCalled();
  });

  it("situação ao vivo não é terminal nem está em allowedPendingStatuses: não escala, só sincroniza internal_status com a realidade", async () => {
    mockLiveSituacao(748743); // WAITING_CHANNEL_VALIDATION

    const result = await escalateToHumanVerificationIfStillPending({
      idOrderSystem: 1001,
      blingApi,
      allowedPendingStatuses: [OrderInternalStatus.OPEN], // só espera OPEN
      reasonCancelled: OrderReasonCancelled.DOCUMENT_INVALID,
    });

    expect(result).toEqual({
      escalated: false,
      reason: "unexpected-status",
      internalStatus: OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
    });
    expect(blingPatch).not.toHaveBeenCalled();
    expect(ordersService.update).toHaveBeenCalledWith("o1", {
      internal_status: OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
    });
  });

  it("pedido local não encontrado ao tentar escalar: PATCH já foi feito na Bling, mas retorna order-not-found sem gravar nada no banco", async () => {
    mockLiveSituacao(6); // OPEN — bate com allowedPendingStatuses
    (ordersService.findOne as jest.Mock).mockResolvedValue(undefined);

    const result = await escalateToHumanVerificationIfStillPending({
      idOrderSystem: 1001,
      blingApi,
      allowedPendingStatuses: [OrderInternalStatus.OPEN],
      reasonCancelled: OrderReasonCancelled.DOCUMENT_INVALID,
    });

    expect(result).toEqual({
      escalated: false,
      reason: "order-not-found",
      internalStatus: OrderInternalStatus.OPEN,
    });
    expect(blingPatch).toHaveBeenCalled();
    expect(ordersService.update).not.toHaveBeenCalled();
  });

  it("sempre busca a situação AO VIVO — nunca confia em nada calculado antes da chamada", async () => {
    mockLiveSituacao(9); // já terminal, ao vivo

    await escalateToHumanVerificationIfStillPending({
      idOrderSystem: 1001,
      blingApi,
      allowedPendingStatuses: [OrderInternalStatus.OPEN],
      reasonCancelled: OrderReasonCancelled.DOCUMENT_INVALID,
    });

    expect(blingGet).toHaveBeenCalledWith("/pedidos/vendas/1001", blingApi);
  });
});
