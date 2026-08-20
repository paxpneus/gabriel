import { AxiosInstance } from "axios";
import { OrderInternalStatus } from "../../../../../sales/orders/order/orders.types";

// ─── Mocks dos módulos externos ───────────────────────────────────────────────

jest.mock("../../../../../sales/orders/order/orders.service", () => ({
  __esModule: true,
  default: {
    findOne: jest.fn(),
    update: jest.fn(),
    create: jest.fn(),
    delete: jest.fn(),
  },
}));

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
  create: jest.fn(),
};
jest.mock("../../../../../sales/stores/stores.service", () => ({
  __esModule: true,
  StoreService: jest.fn().mockImplementation(() => mockStoreServiceInstance),
}));

jest.mock("../../../api/bling_api.service", () => ({
  __esModule: true,
  getBlingIntegration: jest.fn(),
}));

import ordersService from "../../../../../sales/orders/order/orders.service";
import orderItemsService from "../../../../../sales/orders/order_items/order_items.service";
import { getBlingIntegration } from "../../../api/bling_api.service";
import UnitBusiness from "../../../../../company/unit-business/unit-business.model";
import BlingOrderService from "../bling-order.service";

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

function makeFakeBlingApi(orderData: any): AxiosInstance {
  const get = jest.fn().mockImplementation((url: string) => {
    if (url.startsWith("/pedidos/vendas/")) {
      return Promise.resolve({ data: { data: orderData } });
    }
    if (url.startsWith("/contatos/")) {
      return Promise.resolve({ data: { data: {} } });
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
  });
});
