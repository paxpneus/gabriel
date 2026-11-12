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
import invoiceReportsRepository from "../repositories/reports.repository";
import invoiceOperationRepository from "../../../invoice-operation/invoice-operation.repository";

describe("InvoiceReportsRepository.findAllTransferInvoices — sem nota interna", () => {
  it("/report/transfer: mesmo recorte do /transfer/list, sem a operação interna", async () => {
    (invoiceOperationRepository.findIdByCode as jest.Mock).mockResolvedValue("op-internal");
    const findAll = jest.spyOn((invoiceReportsRepository as any).model, "findAll").mockResolvedValue([]);

    await invoiceReportsRepository.findAllTransferInvoices({} as any, undefined);

    // Sem filtros o QueryParser devolve where vazio, combinado com o forçado por Op.and.
    expect((findAll.mock.calls[0][0] as any).where).toEqual({
      [Op.and]: [
        {},
        {
          sender_cnpj: { [Op.in]: ["12", "24"] },
          receiver_cnpj: { [Op.in]: ["12", "24"] },
          invoice_operation_id: { [Op.or]: { [Op.is]: null, [Op.ne]: "op-internal" } },
        },
      ],
    });
  });
});
