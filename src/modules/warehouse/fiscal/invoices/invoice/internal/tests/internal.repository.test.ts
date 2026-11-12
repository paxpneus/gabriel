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
  invoiceAttributesRepository: { findUnitBusinessCnpjById: jest.fn().mockResolvedValue("24"), findUnitBusinessNamesByCnpj: jest.fn().mockResolvedValue(new Map([["12", "Loja 01 - A"], ["24", "Loja 02 - B"]])) },
}));

jest.mock("../../../invoice-operation/invoice-operation.repository", () => ({
  __esModule: true,
  default: { findIdByCode: jest.fn() },
}));

import { Op } from "sequelize";
import internalInvoiceRepository from "../repositories/internal.repository";

describe("InternalInvoiceRepository.listInternalInvoices", () => {
  it("só a operação interna emitida/recebida pela loja do usuário, com a projeção da transferência", async () => {
    const findPaginated = jest
      .spyOn(internalInvoiceRepository, "findPaginated")
      .mockResolvedValue({ data: [], meta: { total: 0 } } as any);

    const result = await internalInvoiceRepository.listInternalInvoices({} as any, "ub-24", "op-internal");

    expect(result).toEqual({ data: [], meta: { total: 0 } });
    const [, , extraOptions, forcedWhere] = findPaginated.mock.calls[0];
    expect(forcedWhere).toEqual({
      invoice_operation_id: "op-internal",
      [Op.or]: [{ sender_cnpj: "24" }, { receiver_cnpj: "24" }],
    });
    // Projeção da transferência: exclui XML/payload e traz o vínculo de lote.
    expect((extraOptions as any).attributes.exclude).toEqual(["source_payload", "xml_path", "observation"]);
  });
});
