// Infra mockada: list-query puxa a fachada de inventory, que carrega services com Queue/Redis reais.
jest.mock("../../../../../../../config/redis", () => ({
  __esModule: true,
  redisConfig: {},
  redisClient: { get: jest.fn(), set: jest.fn(), del: jest.fn(), eval: jest.fn(), on: jest.fn() },
}));

jest.mock("bullmq", () => ({
  __esModule: true,
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), getJob: jest.fn() })),
  QueueEvents: jest.fn().mockImplementation(() => ({})),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn() })),
  DelayedError: class DelayedError extends Error {},
  UnrecoverableError: class UnrecoverableError extends Error {},
}));

// Só os helpers puros do shared são reais; repository de CNPJs mockado.
jest.mock("../../shared", () => ({
  __esModule: true,
  ...jest.requireActual("../../shared/helpers/list-query"),
  ...jest.requireActual("../../shared/helpers/invoice-operation"),
  ...jest.requireActual("../../shared/helpers/batch-invoice-scope"),
  ...jest.requireActual("../../shared/helpers/totals"),
  ...jest.requireActual("../../shared/helpers/nfe-ide"),
  invoiceAttributesRepository: { findAllUnitBusinessCnpjs: jest.fn().mockResolvedValue(["12", "24"]) },
}));

jest.mock("../../../invoice-operation/invoice-operation.repository", () => ({
  __esModule: true,
  default: { findIdByCode: jest.fn() },
}));

import { Op } from "sequelize";
import invoiceRepository from "../repositories/invoice.repository";
import invoiceOperationRepository from "../../../invoice-operation/invoice-operation.repository";
import { INVOICE_OPERATION_CODES } from "../../../invoice-operation/invoice-operation.types";

const findIdByCode = invoiceOperationRepository.findIdByCode as jest.Mock;
const notInternal = { invoice_operation_id: { [Op.or]: { [Op.is]: null, [Op.ne]: "op-internal" } } };

describe("InvoiceRepository — listagens sem nota interna", () => {
  let findPaginated: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    findIdByCode.mockResolvedValue("op-internal");
    findPaginated = jest
      .spyOn(invoiceRepository, "findPaginated")
      .mockResolvedValue({ data: [], meta: {} } as any);
  });

  it("GET /invoice: exclui a operação interna e mantém o filtro de transportadora", async () => {
    await invoiceRepository.listInvoices({ filters: { transporterStatus: "pending-tr-1" } } as any, "ub-12");

    expect(findIdByCode).toHaveBeenCalledWith(INVOICE_OPERATION_CODES.INTERNAL_TRANSFER);
    expect(findPaginated.mock.calls[0][3]).toEqual({ transporter_id: "tr-1", ...notInternal });
  });

  it("/transfer/list: exclui a operação interna junto do recorte entre lojas", async () => {
    await invoiceRepository.listTransferInvoices({} as any, undefined);

    expect(findPaginated.mock.calls[0][3]).toEqual({
      sender_cnpj: { [Op.in]: ["12", "24"] },
      receiver_cnpj: { [Op.in]: ["12", "24"] },
      ...notInternal,
    });
  });

  it("sem a operação cadastrada não filtra por operação", async () => {
    findIdByCode.mockResolvedValue(null);

    await invoiceRepository.listInvoices({} as any, "ub-12");

    expect(findPaginated.mock.calls[0][3]).toEqual({});
  });
});
