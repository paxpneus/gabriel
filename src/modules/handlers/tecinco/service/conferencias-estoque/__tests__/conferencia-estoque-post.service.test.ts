// Models (*.model.ts) são auto-mockados globalmente via src/__tests__/setup.ts.

const mockConferir = jest.fn();
jest.mock("../conferencias-estoque.service", () => ({
  __esModule: true,
  TCarConferenciaEstoqueService: jest.fn().mockImplementation(() => ({ conferir: mockConferir })),
}));

jest.mock("../../../queues/helpers/product.helpers", () => ({
  __esModule: true,
  resolveProductByMappingOnly: jest.fn(),
  resolveIntegrationsIdForUnitBusiness: jest.fn(),
}));

jest.mock("../../../../../inventory", () => ({
  __esModule: true,
  ProductConfig: {},
  SupplierMapping: {},
}));

import ExpeditionBatchInvoice from "../../../../../warehouse/expedition/batch-invoices/batch-invoices.model";
import InvoiceUnitBusinessAttributes from "../../../../../warehouse/fiscal/invoices/invoice-unit-business-attributes/invoice-unit-business-attributes.model";
import { TCarConferenciaPostService } from "../conferencia-estoque-post.service";

const UNIT_BUSINESS = { id: "ub-cd", cnpj: "11111111000111", number: "12" };

const batchInvoice = (id: string, invoiceId: string, isTransshipment: boolean) => ({
  id,
  is_transshipment: isTransshipment,
  invoice: {
    id: invoiceId,
    number_system: `NF-${invoiceId}`,
    sender_cnpj: "22222222000122",
    receiver_cnpj: UNIT_BUSINESS.cnpj,
    xml_key: null,
  },
  batch: { unitBusiness: UNIT_BUSINESS },
});

describe("TCarConferenciaPostService.postarConferenciaPorLote — transbordo", () => {
  let service: TCarConferenciaPostService;
  let montarVerificacao: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new TCarConferenciaPostService();
    montarVerificacao = jest
      .spyOn(service as any, "montarVerificacao")
      .mockImplementation(async (ctx: any) => ({
        numero: ctx.numero,
        sincronizado: false,
        itens_a_conferir: [{ seq: 1 }],
        extraParams: {},
      }));
    (InvoiceUnitBusinessAttributes.findOne as jest.Mock).mockResolvedValue({ type: "INCOMING" });
    mockConferir.mockResolvedValue({ ok: true });
    jest.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    (console.log as jest.Mock).mockRestore();
  });

  it("lote só com notas de transbordo: não posta nada e não dá erro (finishBatch segue)", async () => {
    (ExpeditionBatchInvoice.findAll as jest.Mock).mockResolvedValue([
      batchInvoice("bi-1", "inv-1", true),
      batchInvoice("bi-2", "inv-2", true),
    ]);

    await expect(service.postarConferenciaPorLote("batch-1", 12, 1)).resolves.toEqual([]);
    expect(montarVerificacao).not.toHaveBeenCalled();
    expect(mockConferir).not.toHaveBeenCalled();
  });

  it("lote misto: posta só as notas da própria loja e ignora as de transbordo", async () => {
    (ExpeditionBatchInvoice.findAll as jest.Mock).mockResolvedValue([
      batchInvoice("bi-1", "inv-own", false),
      batchInvoice("bi-2", "inv-transit", true),
    ]);

    const results = await service.postarConferenciaPorLote("batch-1", 12, 1);

    expect(results).toHaveLength(1);
    expect(montarVerificacao).toHaveBeenCalledTimes(1);
    expect(montarVerificacao.mock.calls[0][0]).toEqual(
      expect.objectContaining({ invoiceId: "inv-own", batchInvoiceId: "bi-1" }),
    );
    expect(mockConferir).toHaveBeenCalledTimes(1);
    expect(mockConferir).toHaveBeenCalledWith(
      12,
      "nota-fiscal",
      "NF-inv-own",
      expect.anything(),
      expect.anything(),
    );
  });

  it("lote sem nenhuma nota continua dando erro (comportamento de sempre)", async () => {
    (ExpeditionBatchInvoice.findAll as jest.Mock).mockResolvedValue([]);

    await expect(service.postarConferenciaPorLote("batch-1", 12, 1)).rejects.toThrow(
      "Nenhuma invoice encontrada para o lote batch-1",
    );
  });
});
