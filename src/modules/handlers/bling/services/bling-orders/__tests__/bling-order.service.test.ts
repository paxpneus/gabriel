// ─── Mocks de infraestrutura (Redis/BullMQ) — este arquivo importa (mesmo
// que só pelo tipo) algo que puxa BlingApiFetchQueue/TCarUpsertQueue, que
// por sua vez importam uploaderQueue (BaseQueueService cria Queue/QueueEvents
// reais no construtor mesmo com workless:true). Sem isso, o import abre
// conexão de verdade com o Redis e o processo nunca sai (--runInBand trava). ──

jest.mock("../../../../../../config/redis", () => ({
  __esModule: true,
  redisConfig: {},
  redisClient: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    eval: jest.fn(),
    zadd: jest.fn(),
    zrem: jest.fn(),
    zrange: jest.fn(),
    exists: jest.fn(),
    scan: jest.fn(),
    on: jest.fn(),
  },
}));

jest.mock("bullmq", () => ({
  __esModule: true,
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), getJob: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation(() => ({})),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  DelayedError: class DelayedError extends Error {},
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

import { AxiosInstance } from "axios";
import { OrderInternalStatus } from "../../../../../sales/orders/order/orders.types";

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

jest.mock("../../../../../sales/orders/order/orders.service", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
    isEligibleForPdv: jest.fn(),
  },
}));

// createEmptyRequestForNewOrderIfEligible roda incondicionalmente em toda
// criação de pedido (ver bling-order.service.ts) — mockado pra não exercitar
// a repository real do PDV (sqlite em memória sem as tabelas do módulo)
// nestes testes, que são só do fluxo de criação/atualização de Order.
jest.mock(
  "../../../../../sales/pdv-management/sales-request/pdv-sales-request.service",
  () => ({
    __esModule: true,
    default: {
      createEmptyRequestForNewOrderIfEligible: jest.fn(),
      markSaleInvoiceReadyIfPending: jest.fn(),
      cancelIfActiveByOrderId: jest.fn(),
    },
  }),
);

jest.mock("../../../../../sales/orders/order_items/order_items.service", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    bulkCreate: jest.fn(),
  },
}));

const mockBlingCustomerServiceInstance = {
  updateCustomer: jest.fn(),
  getOrCreateCustomer: jest.fn(),
};
jest.mock("../../bling-customers/bling-customer.service", () => ({
  __esModule: true,
  BlingCustomerService: jest
    .fn()
    .mockImplementation(() => mockBlingCustomerServiceInstance),
}));

const mockStoreServiceInstance = {
  findOne: jest.fn(),
  findOrCreateByName: jest.fn(),
};
jest.mock("../../../../../sales/stores/stores.service", () => ({
  __esModule: true,
  StoreService: jest.fn().mockImplementation(() => mockStoreServiceInstance),
}));

jest.mock("../../../api/bling_api.service", () => ({
  __esModule: true,
  getBlingIntegration: jest.fn(),
}));

jest.mock(
  "../../../../../warehouse/fiscal/invoices/invoice/invoice.service",
  () => ({
    __esModule: true,
    default: {
      findOne: jest.fn(),
      createStub: jest.fn(),
    },
  }),
);

import pdvSalesRequestService from "../../../../../sales/pdv-management/sales-request/pdv-sales-request.service";
import ordersService from "../../../../../sales/orders/order/orders.service";
import orderItemsService from "../../../../../sales/orders/order_items/order_items.service";
import { getBlingIntegration } from "../../../api/bling_api.service";
import UnitBusiness from "../../../../../company/unit-business/unit-business.model";
import invoiceService from "../../../../../warehouse/fiscal/invoices/invoice/invoice.service";
import BlingOrderService from "../bling-order.service";
import { startOfDayTz } from "../../../../../../shared/utils/normalizers/date";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const INTEGRATION_ID = "integration-1";

function makeIntegration(overrides: Partial<any> = {}) {
  return {
    id: INTEGRATION_ID,
    cnaes: [],
    allowed_channels: ["MercadoLivre"],
    ...overrides,
  };
}

function makeExistingOrder(overrides: Partial<any> = {}) {
  const base: any = {
    id: "order-uuid-1",
    unit_business_id: "ub-existing",
    nfe_emitted: false,
    destination_uf: "SP",
    destination_city: "São Paulo",
    ipi_value: 0,
    pis_value: 0,
    cofins_value: 0,
    difal_value: 0,
    ibs_value: 0,
    cbs_value: 0,
    approx_tax_value: 0,
    icms_value: 0,
    ...overrides,
  };
  base.dataValues = { ...base };
  return base;
}

// Payload baseado no exemplo real fornecido pelo usuário (situacao.id=834029,
// SENT_TO_TRANSPORTER), sem "vendedor" e com "itens" vazio para não exercitar
// a resolução de produto/custo/comissão (fora do escopo destes testes).
function makeOrderData(overrides: Partial<any> = {}) {
  return {
    id: 26577371207,
    numero: 16603,
    numeroLoja: "000000461_239",
    data: "2026-08-11",
    totalProdutos: 2086.66,
    total: 1933.57,
    contato: {
      id: 18321757897,
      nome: "DANIEL CAMPOS PAIVA",
      tipoPessoa: "F",
      numeroDocumento: "548.829.156-34",
    },
    dataPrevista: undefined as string | undefined,
    situacao: { id: 834029, valor: 0 },
    loja: { id: 205955595 },
    notaFiscal: { id: 26587010552 },
    desconto: { valor: 222.57, unidade: "REAL" },
    outrasDespesas: 0,
    transporte: { frete: 69.48, pesoBruto: 35.34, fretePorConta: 0 },
    taxas: { taxaComissao: 0, custoFrete: 0, valorBase: 0 },
    itens: [],
    ...overrides,
  };
}

function makeFakeBlingApi(
  orderData: any,
  nfeResponse: any = {},
): AxiosInstance {
  const get = jest.fn().mockImplementation((url: string) => {
    if (url.startsWith("/pedidos/vendas/")) {
      return Promise.resolve({ data: { data: orderData } });
    }
    if (url.startsWith("/contatos/")) {
      return Promise.resolve({ data: { data: {} } });
    }
    if (url.startsWith("/nfe/")) {
      return Promise.resolve({ data: { data: nfeResponse } });
    }
    return Promise.resolve({ data: { data: {} } });
  });

  return { get, post: jest.fn(), put: jest.fn(), patch: jest.fn() } as unknown as AxiosInstance;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe("BlingOrderService", () => {
  let service: BlingOrderService;
  let orderData: ReturnType<typeof makeOrderData>;

  beforeEach(() => {
    jest.clearAllMocks();

    orderData = makeOrderData();
    service = new BlingOrderService(makeFakeBlingApi(orderData) as any);

    (getBlingIntegration as jest.Mock).mockResolvedValue(makeIntegration());
    mockStoreServiceInstance.findOne.mockResolvedValue({
      id: "store-1",
      name: "MercadoLivre",
    });
    mockBlingCustomerServiceInstance.updateCustomer.mockResolvedValue({
      id: "customer-1",
    });
    mockBlingCustomerServiceInstance.getOrCreateCustomer.mockResolvedValue({
      id: "customer-1",
    });
    (ordersService.findOne as jest.Mock).mockResolvedValue(makeExistingOrder());
    (ordersService.update as jest.Mock).mockResolvedValue([1]);
    (ordersService.create as jest.Mock).mockResolvedValue({
      id: "new-order-id",
      dataValues: { id: "new-order-id" },
    });
    (orderItemsService.bulkCreate as jest.Mock).mockResolvedValue([]);
  });

  // Recupera o objeto exato passado para ordersService.update, sem depender
  // da ordem das chamadas anteriores (ex.: findOne re-executado por delegação).
  function lastUpdateFields(): any {
    const calls = (ordersService.update as jest.Mock).mock.calls;
    return calls[calls.length - 1][1];
  }

  describe("updateOrderFromBling — mapeamento de status", () => {
    it("situacao.id=9 (EMITTED) grava internal_status=EMITTED e nfe_emitted=true", async () => {
      orderData.situacao = { id: 9, valor: 0 };

      await service.updateOrderFromBling({ data: { id: orderData.id } } as any);

      expect(ordersService.update).toHaveBeenCalledWith(
        "order-uuid-1",
        expect.objectContaining({
          internal_status: OrderInternalStatus.EMITTED,
          nfe_emitted: true,
        }),
      );
    });

    it("situacao.id=6 (OPEN) mantém nfe_emitted anterior (não força false) — documenta achado G1", async () => {
      orderData.situacao = { id: 6, valor: 0 };
      (ordersService.findOne as jest.Mock).mockResolvedValue(
        makeExistingOrder({ nfe_emitted: true }),
      );

      await service.updateOrderFromBling({ data: { id: orderData.id } } as any);

      expect(lastUpdateFields()).toEqual(
        expect.objectContaining({
          internal_status: OrderInternalStatus.OPEN,
          nfe_emitted: true, // valor antigo mantido, não é zerado
        }),
      );
    });

    it.each([12, 21, 748772])(
      "situacao.id=%i (variações de CANCELLED) grava internal_status=CANCELLED e nfe_emitted=false",
      async (situacaoId) => {
        orderData.situacao = { id: situacaoId, valor: 0 };

        await service.updateOrderFromBling({ data: { id: orderData.id } } as any);

        expect(lastUpdateFields()).toEqual(
          expect.objectContaining({
            internal_status: OrderInternalStatus.CANCELLED,
            nfe_emitted: false,
          }),
        );
      },
    );

    it("situacao.id=12 cancela a PdvSalesRequest ativa do pedido", async () => {
      orderData.situacao = { id: 12, valor: 0 };

      await service.updateOrderFromBling({ data: { id: orderData.id } } as any);

      expect(pdvSalesRequestService.cancelIfActiveByOrderId).toHaveBeenCalledWith(
        "order-uuid-1",
      );
    });

    it.each([21, 748772, 9, 6])(
      "situacao.id=%i não cancela a PdvSalesRequest",
      async (situacaoId) => {
        orderData.situacao = { id: situacaoId, valor: 0 };

        await service.updateOrderFromBling({ data: { id: orderData.id } } as any);

        expect(pdvSalesRequestService.cancelIfActiveByOrderId).not.toHaveBeenCalled();
      },
    );

    it.each([12, 21])(
      "situacao.id=%i (cancelamento real via Bling/cliente) grava reason_cancelled=CUSTOMER_CANCELLED",
      async (situacaoId) => {
        orderData.situacao = { id: situacaoId, valor: 0 };

        await service.updateOrderFromBling({ data: { id: orderData.id } } as any);

        expect(lastUpdateFields()).toEqual(
          expect.objectContaining({ reason_cancelled: "CUSTOMER_CANCELLED" }),
        );
      },
    );

    it("situacao.id=748772 (verificação humana, já decidida por uma fila) NÃO grava reason_cancelled — não sobrescreve o motivo já gravado antes", async () => {
      orderData.situacao = { id: 748772, valor: 0 };

      await service.updateOrderFromBling({ data: { id: orderData.id } } as any);

      expect(lastUpdateFields()).not.toHaveProperty("reason_cancelled");
    });

    it("situacao.id=9 (EMITTED) NÃO grava reason_cancelled", async () => {
      orderData.situacao = { id: 9, valor: 0 };

      await service.updateOrderFromBling({ data: { id: orderData.id } } as any);

      expect(lastUpdateFields()).not.toHaveProperty("reason_cancelled");
    });

    it("grava actual_situation/internal_status ANTES de qualquer etapa de enriquecimento, mesmo se uma delas falhar depois (ex.: updateCustomer)", async () => {
      orderData.situacao = { id: 9, valor: 0 };
      mockBlingCustomerServiceInstance.updateCustomer.mockRejectedValue(
        new Error("Falha simulada ao atualizar contato"),
      );

      await expect(
        service.updateOrderFromBling({ data: { id: orderData.id } } as any),
      ).rejects.toThrow("Falha simulada ao atualizar contato");

      const calls = (ordersService.update as jest.Mock).mock.calls;
      expect(calls[0]).toEqual([
        "order-uuid-1",
        {
          actual_situation: "9",
          internal_status: OrderInternalStatus.EMITTED,
          unit_business_id: "ub-existing",
        },
      ]);
    });

    it.each([834029, 834030])(
      "situacao.id=%i (SENT_TO_TRANSPORTER/DELIVERED) grava nfe_emitted=true",
      async (situacaoId) => {
        orderData.situacao = { id: situacaoId, valor: 0 };

        await service.updateOrderFromBling({ data: { id: orderData.id } } as any);

        expect(lastUpdateFields()).toEqual(
          expect.objectContaining({ nfe_emitted: true }),
        );
      },
    );

    it("situacao.id !== 6 retorna null (gate), mesmo já tendo persistido a atualização — payload real do usuário (834029)", async () => {
      // situacao.id=834029 já é o default de makeOrderData(), reproduzindo
      // exatamente o payload de exemplo fornecido na auditoria.
      const result = await service.updateOrderFromBling({
        data: { id: orderData.id },
      } as any);

      expect(ordersService.update).toHaveBeenCalledWith(
        "order-uuid-1",
        expect.objectContaining({
          internal_status: "SENT_TO_TRANSPORTER",
          nfe_emitted: true,
        }),
      );
      expect(result).toBeNull();
    });

    it("canal não permitido (allowed_channels) retorna null mesmo com situacao.id=6", async () => {
      orderData.situacao = { id: 6, valor: 0 };
      (getBlingIntegration as jest.Mock).mockResolvedValue(
        makeIntegration({ allowed_channels: ["OutraLoja"] }),
      );

      const result = await service.updateOrderFromBling({
        data: { id: orderData.id },
      } as any);

      expect(ordersService.update).toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it("situacao.id=6 e canal permitido retorna o orderSystem para seguir no pipeline", async () => {
      orderData.situacao = { id: 6, valor: 0 };

      const result = await service.updateOrderFromBling({
        data: { id: orderData.id },
      } as any);

      expect(result).not.toBeNull();
      expect(result?.orderSystem.internal_status).toBe(OrderInternalStatus.OPEN);
    });
  });

  describe("updateOrderFromBling — pedido não encontrado (cria em vez de pular)", () => {
    it("existingOrder não encontrado — cria o pedido via createOrderFromBling reaproveitando o orderData já buscado, sem 2ª chamada à Bling", async () => {
      const fakeApi = makeFakeBlingApi(orderData);
      service = new BlingOrderService(fakeApi as any);
      (ordersService.findOne as jest.Mock).mockResolvedValue(null);
      (UnitBusiness.findOne as jest.Mock).mockResolvedValue({ id: "ub-1" });

      await service.updateOrderFromBling({
        data: { id: orderData.id },
      } as any);

      expect(ordersService.create).toHaveBeenCalledTimes(1);
      expect(ordersService.update).not.toHaveBeenCalled();
      const orderFetchCalls = (fakeApi.get as jest.Mock).mock.calls.filter(
        ([url]: [string]) => String(url).startsWith("/pedidos/vendas/"),
      );
      expect(orderFetchCalls).toHaveLength(1);
    });

    it("existingOrder não encontrado no update, mas já existe pelo número (corrida) — createOrderFromBling delega de volta pro update em vez de duplicar", async () => {
      const fakeApi = makeFakeBlingApi(orderData);
      service = new BlingOrderService(fakeApi as any);
      // 1ª chamada (dentro de updateOrderFromBling): não encontrado. 2ª
      // chamada (dentro de createOrderFromBling, mesmo orderData): já
      // existe — outra escrita concorrente criou o pedido nesse meio-tempo.
      (ordersService.findOne as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValue(makeExistingOrder());

      await service.updateOrderFromBling({
        data: { id: orderData.id },
      } as any);

      expect(ordersService.create).not.toHaveBeenCalled();
      expect(ordersService.update).toHaveBeenCalled();
    });
  });

  describe("updateOrderFromBling — collection_date (dataPrevista)", () => {
    it("dataPrevista preenchida: grava collection_date em meia-noite BRT", async () => {
      orderData.dataPrevista = "2026-08-20";

      await service.updateOrderFromBling({
        data: { id: orderData.id },
      } as any);

      expect(lastUpdateFields()).toEqual(
        expect.objectContaining({
          collection_date: startOfDayTz("2026-08-20").toDate(),
        }),
      );
    });

    it("dataPrevista vazia: NÃO inclui collection_date no payload de update, preservando o valor já gravado", async () => {
      orderData.dataPrevista = "";
      (ordersService.findOne as jest.Mock).mockResolvedValue(
        makeExistingOrder({ collection_date: new Date("2026-08-15T00:00:00-03:00") }),
      );

      await service.updateOrderFromBling({
        data: { id: orderData.id },
      } as any);

      expect(lastUpdateFields()).not.toHaveProperty("collection_date");
    });

    it("dataPrevista ausente do payload: NÃO inclui collection_date no update", async () => {
      delete orderData.dataPrevista;

      await service.updateOrderFromBling({
        data: { id: orderData.id },
      } as any);

      expect(lastUpdateFields()).not.toHaveProperty("collection_date");
    });

    it("dataPrevista com data-sentinela implausível (ex: 1899-11-30, época zero Delphi/OLE): NÃO inclui collection_date, preservando o valor já gravado", async () => {
      orderData.dataPrevista = "1899-11-30";
      (ordersService.findOne as jest.Mock).mockResolvedValue(
        makeExistingOrder({ collection_date: new Date("2026-08-15T00:00:00-03:00") }),
      );

      await service.updateOrderFromBling({
        data: { id: orderData.id },
      } as any);

      expect(lastUpdateFields()).not.toHaveProperty("collection_date");
    });

    it('dataPrevista com sentinel de data zero do MySQL ("0000-00-00"): NÃO inclui collection_date, preservando o valor já gravado', async () => {
      orderData.dataPrevista = "0000-00-00";
      (ordersService.findOne as jest.Mock).mockResolvedValue(
        makeExistingOrder({ collection_date: new Date("2026-08-15T00:00:00-03:00") }),
      );

      await service.updateOrderFromBling({
        data: { id: orderData.id },
      } as any);

      expect(lastUpdateFields()).not.toHaveProperty("collection_date");
    });
  });

  describe("createOrderFromBling", () => {
    it("delega para updateOrderFromBling quando o pedido já existe (não duplica create)", async () => {
      (ordersService.findOne as jest.Mock).mockResolvedValue(makeExistingOrder());

      await service.createOrderFromBling({ data: { id: orderData.id } } as any);

      expect(ordersService.create).not.toHaveBeenCalled();
      expect(ordersService.update).toHaveBeenCalled();
    });

    it("cria o pedido já com internal_status/nfe_emitted derivados do situacao.id real — achado B1", async () => {
      (ordersService.findOne as jest.Mock).mockResolvedValue(null);
      (UnitBusiness.findOne as jest.Mock).mockResolvedValue({ id: "ub-1" });

      await service.createOrderFromBling({ data: { id: orderData.id } } as any);

      expect(ordersService.create).toHaveBeenCalledTimes(1);
      const createdPayload = (ordersService.create as jest.Mock).mock.calls[0][0];

      // situacao.id=834029 (SENT_TO_TRANSPORTER) neste fixture — o pedido
      // criado deve refletir isso de cara, sem depender de um próximo
      // webhook order.updated pra corrigir o default (OPEN/false) do model.
      expect(createdPayload).toEqual(
        expect.objectContaining({
          actual_situation: "834029",
          internal_status: "SENT_TO_TRANSPORTER",
          nfe_emitted: true,
        }),
      );
    });

    it("dataPrevista preenchida: grava collection_date já na criação", async () => {
      (ordersService.findOne as jest.Mock).mockResolvedValue(null);
      (UnitBusiness.findOne as jest.Mock).mockResolvedValue({ id: "ub-1" });
      orderData.dataPrevista = "2026-09-01";

      await service.createOrderFromBling({ data: { id: orderData.id } } as any);

      const createdPayload = (ordersService.create as jest.Mock).mock.calls[0][0];
      expect(createdPayload).toEqual(
        expect.objectContaining({
          collection_date: startOfDayTz("2026-09-01").toDate(),
        }),
      );
    });

    it("dataPrevista ausente: não inclui collection_date na criação", async () => {
      (ordersService.findOne as jest.Mock).mockResolvedValue(null);
      (UnitBusiness.findOne as jest.Mock).mockResolvedValue({ id: "ub-1" });
      delete orderData.dataPrevista;

      await service.createOrderFromBling({ data: { id: orderData.id } } as any);

      const createdPayload = (ordersService.create as jest.Mock).mock.calls[0][0];
      expect(createdPayload).not.toHaveProperty("collection_date");
    });

    it("dataPrevista com data-sentinela implausível (1899-11-30): não inclui collection_date na criação", async () => {
      (ordersService.findOne as jest.Mock).mockResolvedValue(null);
      (UnitBusiness.findOne as jest.Mock).mockResolvedValue({ id: "ub-1" });
      orderData.dataPrevista = "1899-11-30";

      await service.createOrderFromBling({ data: { id: orderData.id } } as any);

      const createdPayload = (ordersService.create as jest.Mock).mock.calls[0][0];
      expect(createdPayload).not.toHaveProperty("collection_date");
    });
  });

  describe("resolveInvoiceId — vínculo rápido da nota via notaFiscal.id", () => {
    it("nota já existe localmente (id_system) — vincula sem chamar a Bling", async () => {
      (invoiceService.findOne as jest.Mock).mockResolvedValue({
        id: "invoice-local",
      });

      await service.updateOrderFromBling({ data: { id: orderData.id } } as any);

      expect(invoiceService.findOne).toHaveBeenCalledWith({
        where: { id_system: String(orderData.notaFiscal.id) },
      });
      expect(lastUpdateFields()).toEqual(
        expect.objectContaining({ invoice_id: "invoice-local" }),
      );
      expect(invoiceService.createStub).not.toHaveBeenCalled();
      const blingApi = (service as any).blingApi;
      expect(blingApi.get).not.toHaveBeenCalledWith(
        expect.stringContaining("/nfe/"),
      );
    });

    it("nota ainda não existe localmente — busca só o essencial na Bling e vincula uma nota provisória (number_system + linkPDF)", async () => {
      (invoiceService.findOne as jest.Mock).mockResolvedValue(null);
      (invoiceService.createStub as jest.Mock).mockResolvedValue({
        id: "invoice-provisoria",
      });
      service = new BlingOrderService(
        makeFakeBlingApi(orderData, {
          id: orderData.notaFiscal.id,
          numero: "16603",
          linkPDF: "https://bling.com.br/danfe/16603.pdf",
          emitente: { cnpj: "11222333000144", nome: "Loja Origem" },
        }) as any,
      );

      await service.updateOrderFromBling({ data: { id: orderData.id } } as any);

      expect(invoiceService.createStub).toHaveBeenCalledWith(
        expect.objectContaining({
          integrationsId: INTEGRATION_ID,
          numberSystem: "16603",
          idSystem: String(orderData.notaFiscal.id),
          danfePath: "https://bling.com.br/danfe/16603.pdf",
          senderCnpj: "11222333000144",
        }),
      );
      expect(lastUpdateFields()).toEqual(
        expect.objectContaining({ invoice_id: "invoice-provisoria" }),
      );
    });

    it("busca na Bling falha — não derruba o sync do pedido, só segue sem invoice_id", async () => {
      (invoiceService.findOne as jest.Mock).mockResolvedValue(null);
      const failingApi = {
        get: jest.fn().mockImplementation((url: string) => {
          if (url.startsWith("/pedidos/vendas/")) {
            return Promise.resolve({ data: { data: orderData } });
          }
          if (url.startsWith("/nfe/")) {
            return Promise.reject(new Error("timeout"));
          }
          return Promise.resolve({ data: { data: {} } });
        }),
        post: jest.fn(),
        put: jest.fn(),
        patch: jest.fn(),
      };
      service = new BlingOrderService(failingApi as any);

      await service.updateOrderFromBling({ data: { id: orderData.id } } as any);

      expect(invoiceService.createStub).not.toHaveBeenCalled();
      expect(lastUpdateFields()).toEqual(
        expect.objectContaining({ invoice_id: null }),
      );
    });

    it("nota da Bling sem número resolvido — não cria nota provisória", async () => {
      (invoiceService.findOne as jest.Mock).mockResolvedValue(null);
      service = new BlingOrderService(
        makeFakeBlingApi(orderData, { id: orderData.notaFiscal.id }) as any,
      );

      await service.updateOrderFromBling({ data: { id: orderData.id } } as any);

      expect(invoiceService.createStub).not.toHaveBeenCalled();
      expect(lastUpdateFields()).toEqual(
        expect.objectContaining({ invoice_id: null }),
      );
    });
  });
});
