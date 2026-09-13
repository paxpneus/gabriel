import { AxiosInstance } from "axios";
import { OrderInternalStatus } from "../../../../../../sales/orders/order/orders.types";

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

jest.mock("../../../../../../sales/orders/order/orders.service", () => ({
  __esModule: true,
  default: { findById: jest.fn(), update: jest.fn() },
}));

jest.mock("../../../../../../integrations/integrations/integrations.service", () => ({
  __esModule: true,
  default: { getFullIntegration: jest.fn() },
}));

jest.mock("../../../bling/helpers/get-with-sleep", () => ({
  __esModule: true,
  blingGet: jest.fn(),
  blingPatch: jest.fn(),
}));

jest.mock("../../../../../../../shared/utils/queues/setDelay", () => ({
  __esModule: true,
  setDelayBasedOnDate: jest.fn().mockReturnValue(60_000),
}));

// base-queue-service.ts (importado transitivamente por causa de
// withOrderLock) importa alertService — sem mockar, um teste real dispara
// uma verificação de SMTP de verdade contra o Gmail (nodemailer.service.ts),
// que demora bastante pra falhar e atrasa a saída do processo.
jest.mock("../../../../../../../shared/providers/mail-provider/nodemailer.alert", () => ({
  __esModule: true,
  alertService: { sendAlert: jest.fn() },
}));

import ordersService from "../../../../../../sales/orders/order/orders.service";
import integrationsService from "../../../../../../integrations/integrations/integrations.service";
import { blingGet, blingPatch } from "../../../bling/helpers/get-with-sleep";
import { setDelayBasedOnDate } from "../../../../../../../shared/utils/queues/setDelay";
import { CollectionDateSchedulerService } from "../collection-date-scheduler.service";
import { FullOrder } from "../../../../../../sales/orders/order/orders.types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeOrderSystem(overrides: Partial<any> = {}): FullOrder {
  return {
    id: "order-uuid-1",
    id_order_system: "1001",
    number_order_channel: "000000461_239",
    internal_status: OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
    collection_date: new Date("2026-08-10T03:00:00.000Z"), // 2026-08-10 00:00 BRT
    createdAt: new Date("2026-01-01T03:00:00.000Z"),
    waiting_acceptance: false,
    ...overrides,
  } as unknown as FullOrder;
}

// Faz isEligibleForSync devolver true/false conforme o cenário, controlando
// o que ordersService.findById (chamado internamente por isEligibleForSync)
// resolve.
function mockEligible(eligible: boolean) {
  (ordersService.findById as jest.Mock).mockResolvedValue(
    eligible
      ? {
          internal_status: OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
          source_payload: { situacao: { id: "748743" } },
        }
      : { internal_status: OrderInternalStatus.OPEN, source_payload: { situacao: { id: "6" } } },
  );
}

function makeFakeBlingApi(): AxiosInstance {
  return { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn() } as unknown as AxiosInstance;
}

describe("CollectionDateSchedulerService", () => {
  let fakeBlingApi: AxiosInstance;
  let nfeNext: { addDelayed: jest.Mock; removeJob: jest.Mock; getJob: jest.Mock };
  let scheduler: CollectionDateSchedulerService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();

    fakeBlingApi = makeFakeBlingApi();
    nfeNext = {
      addDelayed: jest.fn().mockResolvedValue(undefined),
      removeJob: jest.fn().mockResolvedValue(undefined),
      getJob: jest.fn().mockResolvedValue(undefined),
    };
    scheduler = new CollectionDateSchedulerService(fakeBlingApi, nfeNext as any);

    (ordersService.update as jest.Mock).mockResolvedValue([1]);
    (integrationsService.getFullIntegration as jest.Mock).mockResolvedValue({
      lock_today_orders: false,
    });
    (setDelayBasedOnDate as jest.Mock).mockReturnValue(60_000);
    // situacao 748743 por padrão — finalizeNfeScheduling reconfere isso ao
    // vivo antes do PATCH pra 748748.
    (blingGet as jest.Mock).mockResolvedValue({
      data: { data: { situacao: { id: 748743 } } },
    });
  });

  describe("syncCollectionDateLocked — status terminal", () => {
    it.each([
      OrderInternalStatus.EMITTED,
      OrderInternalStatus.CANCELLED,
      OrderInternalStatus.SENT_TO_TRANSPORTER,
      OrderInternalStatus.DELIVERED,
    ])("internal_status=%s: no-op total, sem tocar no banco nem na Bling", async (status) => {
      const orderSystem = makeOrderSystem({ internal_status: status });

      await scheduler.syncCollectionDateLocked(
        orderSystem.id_order_system!,
        new Date("2026-08-20T03:00:00.000Z"),
        orderSystem,
      );

      expect(ordersService.update).not.toHaveBeenCalled();
      expect(blingGet).not.toHaveBeenCalled();
    });
  });

  describe("syncCollectionDateLocked — WAITING_FOR_NFE_EMISSION (job já agendado)", () => {
    it("dia igual (só horário difere): no-op total, sem removeJob/addDelayed", async () => {
      mockEligible(true);
      const orderSystem = makeOrderSystem({
        internal_status: OrderInternalStatus.WAITING_FOR_NFE_EMISSION,
        collection_date: new Date("2026-08-20T03:00:00.000Z"), // 2026-08-20 00:00 BRT
      });

      await scheduler.syncCollectionDateLocked(
        orderSystem.id_order_system!,
        new Date("2026-08-20T18:45:00.000Z"), // mesmo dia BRT, horário bem diferente
        orderSystem,
      );

      expect(ordersService.update).not.toHaveBeenCalled();
      expect(nfeNext.removeJob).not.toHaveBeenCalled();
      expect(nfeNext.addDelayed).not.toHaveBeenCalled();
    });

    it("dia diferente: grava a nova collection_date, remove o job antigo e reagenda", async () => {
      mockEligible(true);
      const orderSystem = makeOrderSystem({
        internal_status: OrderInternalStatus.WAITING_FOR_NFE_EMISSION,
        collection_date: new Date("2026-08-20T03:00:00.000Z"),
      });
      const newDate = new Date("2026-08-25T03:00:00.000Z");

      await scheduler.syncCollectionDateLocked(orderSystem.id_order_system!, newDate, orderSystem);

      expect(ordersService.update).toHaveBeenCalledWith(orderSystem.id, { collection_date: newDate });
      expect(nfeNext.removeJob).toHaveBeenCalledWith(`nfe-generation-${orderSystem.id_order_system}`);
      expect(blingPatch).toHaveBeenCalledWith(
        `/pedidos/vendas/${orderSystem.id_order_system}/situacoes/748748`,
        { id: 748748 },
        fakeBlingApi,
      );
      expect(nfeNext.addDelayed).toHaveBeenCalledWith(
        expect.objectContaining({ order_id: orderSystem.id_order_system }),
        `nfe-generation-${orderSystem.id_order_system}`,
        60_000,
      );
    });
  });

  describe("syncCollectionDateLocked — OPEN/WAITING_CHANNEL_VALIDATION (nenhum job ainda)", () => {
    it("nota de segurança: OPEN + dia igual → scheduleNfe roda mas isEligibleForSync bloqueia (não é WAITING_CHANNEL_VALIDATION) — nenhuma escrita além da checagem", async () => {
      mockEligible(false); // findById devolve internal_status OPEN → isEligibleForSync=false
      const sameDay = new Date("2026-08-10T03:00:00.000Z");
      const orderSystem = makeOrderSystem({
        internal_status: OrderInternalStatus.OPEN,
        collection_date: sameDay,
      });

      await scheduler.syncCollectionDateLocked(orderSystem.id_order_system!, sameDay, orderSystem);

      // scheduleNfe foi chamado (prova: consultou a integração da Bling),
      // mas isEligibleForSync bloqueou antes de qualquer PATCH/addDelayed.
      expect(integrationsService.getFullIntegration).toHaveBeenCalledWith({ where: { name: "Bling" } });
      expect(ordersService.update).not.toHaveBeenCalled();
      expect(blingPatch).not.toHaveBeenCalled();
      expect(nfeNext.addDelayed).not.toHaveBeenCalled();
    });

    it("dia não mudou mas ainda sem job agendado: NÃO fica em silêncio — scheduleNfe termina agendando", async () => {
      mockEligible(true);
      const sameDay = new Date("2026-08-10T03:00:00.000Z");
      // createdAt/collection_date bem no passado — createdToday=false, então
      // nem entra no ramo de waiting_acceptance, cai direto em
      // finalizeNfeScheduling.
      const orderSystem = makeOrderSystem({
        internal_status: OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
        collection_date: sameDay,
        createdAt: new Date("2026-01-01T03:00:00.000Z"),
      });

      await scheduler.syncCollectionDateLocked(orderSystem.id_order_system!, sameDay, orderSystem);

      // Dia não mudou: nenhuma escrita de collection_date.
      expect(ordersService.update).not.toHaveBeenCalledWith(
        orderSystem.id,
        expect.objectContaining({ collection_date: expect.anything() }),
      );
      // Mas o agendamento em si aconteceu de verdade — não em silêncio.
      expect(blingPatch).toHaveBeenCalledWith(
        `/pedidos/vendas/${orderSystem.id_order_system}/situacoes/748748`,
        { id: 748748 },
        fakeBlingApi,
      );
      expect(ordersService.update).toHaveBeenCalledWith(orderSystem.id, {
        internal_status: OrderInternalStatus.WAITING_FOR_NFE_EMISSION,
      });
      expect(nfeNext.addDelayed).toHaveBeenCalled();
    });

    it("dia mudou: grava a nova collection_date e agenda", async () => {
      mockEligible(true);
      const orderSystem = makeOrderSystem({
        internal_status: OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
        collection_date: new Date("2026-08-10T03:00:00.000Z"),
        createdAt: new Date("2026-01-01T03:00:00.000Z"),
      });
      const newDate = new Date("2026-08-15T03:00:00.000Z");

      await scheduler.syncCollectionDateLocked(orderSystem.id_order_system!, newDate, orderSystem);

      expect(ordersService.update).toHaveBeenCalledWith(orderSystem.id, { collection_date: newDate });
      expect(nfeNext.addDelayed).toHaveBeenCalled();
    });
  });

  describe("scheduleNfe — janela de coleta hoje + lock_today_orders (correção de timezone)", () => {
    it("pedido criado hoje + coleta hoje + lock_today_orders ativo + sem job: trava pra aceite manual, sem PATCH", async () => {
      jest.useFakeTimers().setSystemTime(new Date("2026-08-20T15:00:00.000Z")); // meio-dia BRT
      mockEligible(true);
      (integrationsService.getFullIntegration as jest.Mock).mockResolvedValue({
        lock_today_orders: true,
      });
      const today = new Date("2026-08-20T15:00:00.000Z");
      const orderSystem = makeOrderSystem({
        internal_status: OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
        collection_date: new Date("2026-08-10T03:00:00.000Z"),
        createdAt: today,
      });

      await scheduler.syncCollectionDateLocked(orderSystem.id_order_system!, today, orderSystem);

      expect(ordersService.update).toHaveBeenCalledWith(orderSystem.id, {
        internal_status: OrderInternalStatus.WAITING_FOR_NFE_EMISSION,
        waiting_acceptance: true,
      });
      expect(blingPatch).not.toHaveBeenCalled();
      expect(nfeNext.addDelayed).not.toHaveBeenCalled();
    });

    it("borda da meia-noite BRT: pedido criado 'ontem 23:50 BRT' não conta como 'criado hoje' quando agora é 'hoje 00:05 BRT', mesmo caindo no mesmo dia-calendário UTC", async () => {
      // now = 2026-08-20T00:05:00-03:00 = 2026-08-20T03:05:00Z
      jest.useFakeTimers().setSystemTime(new Date("2026-08-20T03:05:00.000Z"));
      mockEligible(true);
      (integrationsService.getFullIntegration as jest.Mock).mockResolvedValue({
        lock_today_orders: true,
      });
      // createdAt = 2026-08-19T23:50:00-03:00 = 2026-08-20T02:50:00Z — mesmo
      // dia-calendário UTC que "agora", mas dia BRT anterior. Um bug do tipo
      // Date.UTC(now.getUTCFullYear()...) trataria isso como "criado hoje"
      // incorretamente.
      const createdAt = new Date("2026-08-20T02:50:00.000Z");
      const collectionDate = new Date("2026-08-20T03:05:00.000Z"); // "hoje" BRT
      const orderSystem = makeOrderSystem({
        internal_status: OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
        collection_date: new Date("2026-08-10T03:00:00.000Z"),
        createdAt,
      });

      await scheduler.syncCollectionDateLocked(orderSystem.id_order_system!, collectionDate, orderSystem);

      // Não deve ter travado pra aceite manual (createdToday deveria ser
      // false) — deve ter ido direto pro fluxo normal de finalização.
      expect(ordersService.update).not.toHaveBeenCalledWith(
        orderSystem.id,
        expect.objectContaining({ waiting_acceptance: true }),
      );
      expect(blingPatch).toHaveBeenCalledWith(
        `/pedidos/vendas/${orderSystem.id_order_system}/situacoes/748748`,
        { id: 748748 },
        fakeBlingApi,
      );
    });
  });

  describe("finalizeNfeScheduling — reconfere a situação ao vivo na Bling", () => {
    it("situação já divergiu (12=CANCELLED): sincroniza internal_status sem PATCH/addDelayed", async () => {
      mockEligible(true);
      (blingGet as jest.Mock).mockResolvedValue({ data: { data: { situacao: { id: 12 } } } });
      const orderSystem = makeOrderSystem({
        internal_status: OrderInternalStatus.WAITING_CHANNEL_VALIDATION,
        collection_date: new Date("2026-08-10T03:00:00.000Z"),
        createdAt: new Date("2026-01-01T03:00:00.000Z"),
      });
      const newDate = new Date("2026-08-15T03:00:00.000Z");

      await scheduler.syncCollectionDateLocked(orderSystem.id_order_system!, newDate, orderSystem);

      expect(blingPatch).not.toHaveBeenCalled();
      expect(nfeNext.addDelayed).not.toHaveBeenCalled();
      expect(ordersService.update).toHaveBeenCalledWith(orderSystem.id, {
        internal_status: OrderInternalStatus.CANCELLED,
        nfe_emitted: false,
      });
    });
  });
});
