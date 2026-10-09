// ─── Mocks de infraestrutura (Redis/BullMQ) — este arquivo importa (mesmo
// que só pelo tipo) algo que puxa BlingApiFetchQueue/TCarUpsertQueue, que
// por sua vez importam uploaderQueue (BaseQueueService cria Queue/QueueEvents
// reais no construtor mesmo com workless:true). Sem isso, o import abre
// conexão de verdade com o Redis e o processo nunca sai (--runInBand trava). ──

jest.mock("../../../../../config/redis", () => ({
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

// Models (*.model.ts) são auto-mockados globalmente via src/__tests__/setup.ts.

jest.mock("../../../../../config/sequelize", () => ({
  __esModule: true,
  default: { transaction: jest.fn((cb: any) => cb({})) },
}));

jest.mock("../../../fiscal/invoices/invoice/invoice.service", () => ({
  __esModule: true,
  default: { findById: jest.fn(), findAll: jest.fn() },
}));

jest.mock("../../../../company/unit-business/unit-business.service", () => ({
  __esModule: true,
  default: { getCd21UnitBusiness: jest.fn(), getOrUpdateLastOutgoingBatchNumber: jest.fn() },
}));

jest.mock("../../batch-invoices/batch-invoices.service", () => ({
  __esModule: true,
  default: { findBatchIdsByInvoiceIds: jest.fn() },
}));

jest.mock("../batch.repository", () => ({
  __esModule: true,
  default: { findPendingOutgoingByTransporter: jest.fn() },
}));

jest.mock(
  "../../../../sales/pdv-management/sales-request/pdv-sales-request.service",
  () => ({
    __esModule: true,
    default: {
      resolveSaleInvoiceIds: jest.fn(),
      findBatchTargets: jest.fn(),
      notifyChangedBySaleInvoiceIds: jest.fn(),
    },
  }),
);

import { Op } from "sequelize";
import invoiceService from "../../../fiscal/invoices/invoice/invoice.service";
import unitBusinessService from "../../../../company/unit-business/unit-business.service";
import pdvSalesRequestService from "../../../../sales/pdv-management/sales-request/pdv-sales-request.service";
import batchInvoicesService from "../../batch-invoices/batch-invoices.service";
import expeditionBatchRepository from "../batch.repository";
import { ExpeditionBatchService } from "../batch.service";
import { PdvBatchSkipReason } from "../batch.types";
import {
  PdvBatchStage,
  PdvBatchTargetFilter,
  PdvSalesRequestStatus,
} from "../../../../sales/pdv-management/sales-request/pdv-sales-request.types";

type Stage = "none" | "open" | "finished";

interface Row {
  id: string;
  status: PdvSalesRequestStatus;
  cd: string | null;
  stage: Stage;
  sale_invoice_id: string | null;
  order_number: string;
  transporter_id: string | null;
  transporter_name: string | null;
}

const S = PdvSalesRequestStatus;

// Simula o where do repository (ids/status/transportadora/estágio) sobre linhas em memória.
function fakeBatchTargets(rows: Row[]) {
  return async (filter: PdvBatchTargetFilter) =>
    rows
      .filter((row) => !filter.ids || filter.ids.includes(row.id))
      .filter((row) => !filter.status || row.status === filter.status)
      .filter((row) => {
        if (!filter.transporter) return true;
        return "cd" in filter.transporter
          ? row.cd === filter.transporter.cd
          : row.transporter_id === filter.transporter.transporterId;
      })
      .filter((row) => {
        switch (filter.batchStage) {
          case undefined:
            return true;
          case PdvBatchStage.WITHOUT_BATCH:
            return row.stage === "none" && !!row.sale_invoice_id;
          case PdvBatchStage.IN_BATCH:
            return row.stage !== "none";
          case PdvBatchStage.FINISHED_WITHOUT_DELIVERY_NOTE:
            return row.stage === "finished";
          default:
            return false;
        }
      })
      .map(({ id, sale_invoice_id, order_number, transporter_id, transporter_name }) => ({
        id,
        sale_invoice_id,
        order_number,
        transporter_id,
        transporter_name,
      }));
}

function row(partial: Partial<Row> & Pick<Row, "id">): Row {
  const n = partial.id.replace(/\D/g, "");
  return {
    status: S.SHIPPING,
    cd: "12",
    stage: "none",
    sale_invoice_id: `inv-${n}`,
    order_number: `P${n}`,
    transporter_id: "t-cd12",
    transporter_name: "ADT - CD 12",
    ...partial,
  };
}

describe("ExpeditionBatchService — lote pendente de saída pelo link CD21", () => {
  let service: ExpeditionBatchService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ExpeditionBatchService();
    (unitBusinessService.getCd21UnitBusiness as jest.Mock).mockResolvedValue({
      id: "cd21-id",
    });
  });

  it("searchCd21PendingOutgoing: delega pra searchPendingOutgoing escopado no CD21", async () => {
    const result = { data: [], total: 0 } as any;
    const spy = jest
      .spyOn(service, "searchPendingOutgoing")
      .mockResolvedValue(result);
    const params = { search: "x" } as any;

    await expect(service.searchCd21PendingOutgoing(params)).resolves.toBe(
      result,
    );
    expect(spy).toHaveBeenCalledWith(params, "cd21-id");
  });

  describe("ações de lote do PDV", () => {
    let rows: Row[];

    beforeEach(() => {
      rows = [
        row({ id: "sr-1" }),
        row({ id: "sr-2" }),
        row({ id: "sr-3", cd: "17", transporter_id: "t-cd17", transporter_name: "ADT - CD 17" }),
        row({ id: "sr-4", stage: "open" }),
        row({ id: "sr-5", stage: "finished" }),
        row({
          id: "sr-6",
          status: S.SHIP_TODAY,
          cd: null,
          transporter_id: "t-jadlog",
          transporter_name: "JADLOG",
        }),
      ];
      (pdvSalesRequestService.findBatchTargets as jest.Mock).mockImplementation(
        (filter: PdvBatchTargetFilter) => fakeBatchTargets(rows)(filter),
      );
      (pdvSalesRequestService.resolveSaleInvoiceIds as jest.Mock).mockImplementation(
        async (ids: string[]) =>
          rows.filter((r) => ids.includes(r.id)).map((r) => r.sale_invoice_id),
      );
      (invoiceService.findAll as jest.Mock).mockImplementation(async ({ where }: any) => {
        const ids: string[] = where.id[Op.in];
        return ids.map((id) => ({ id, xml_key: `KEY-${id}`, number_system: id }));
      });
    });

    describe("validação de coluna/transportadora", () => {
      it("status fora de SHIPPING/SHIP_TODAY → mensagem com as colunas", async () => {
        await expect(service.generateBatchFromPdv({ status: "FINISHED" })).rejects.toThrow(
          'Ações de lote só existem nas colunas "Pendente expedição ADT" e "Embarca hoje".',
        );
      });

      it("SHIPPING com CD fora de 12/17 → rejeita", async () => {
        await expect(
          service.generateBatchFromPdv({ status: S.SHIPPING, cd: "21" }),
        ).rejects.toThrow("Transportadora inválida");
      });

      it("SHIPPING só com transporter_id → pede o CD", async () => {
        await expect(
          service.generateBatchFromPdv({ status: S.SHIPPING, transporterId: "t-1" }),
        ).rejects.toThrow('Na coluna "Pendente expedição ADT", informe o CD (12 ou 17).');
      });

      it("SHIP_TODAY só com cd → pede a transportadora", async () => {
        await expect(
          service.generateBatchFromPdv({ status: S.SHIP_TODAY, cd: "12" }),
        ).rejects.toThrow('Na coluna "Embarca hoje", informe a transportadora.');
      });

      it("escolhida fora da coluna + transportadora → mensagem com o pedido", async () => {
        await expect(
          service.generateBatchFromPdv({ status: S.SHIPPING, cd: "12", salesRequestIds: ["sr-3"] }),
        ).rejects.toThrow(
          'A solicitação do pedido P3 não está em "Pendente expedição ADT" da transportadora CD 12.',
        );
      });

      it("várias escolhidas, parte fora → lista só as de fora", async () => {
        await expect(
          service.generateBatchFromPdv({
            status: S.SHIPPING,
            cd: "12",
            salesRequestIds: ["sr-1", "sr-3"],
          }),
        ).rejects.toThrow(
          'Nem todas as solicitações selecionadas estão em "Pendente expedição ADT" da transportadora CD 12. Fora: pedidos P3.',
        );
      });
    });

    describe("gerar lote", () => {
      it("coluna + CD: todas sem lote daquele CD num lote só", async () => {
        const generate = jest
          .spyOn(service, "generateBatchFromInvoices")
          .mockResolvedValue({ id: "b-new" } as any);

        const result = await service.generateBatchFromPdv({ status: S.SHIPPING, cd: "12" });

        expect(generate).toHaveBeenCalledTimes(1);
        expect(generate).toHaveBeenCalledWith(["inv-1", "inv-2"], "cd21-id", "OUTGOING", "REGULAR");
        expect(result).toEqual({ batches: [{ id: "b-new" }], skipped: [], warnings: [] });
        expect(pdvSalesRequestService.notifyChangedBySaleInvoiceIds).toHaveBeenCalledWith([
          "inv-1",
          "inv-2",
        ]);
      });

      it("só a coluna: um lote por transportadora da nota de venda", async () => {
        const generate = jest
          .spyOn(service, "generateBatchFromInvoices")
          .mockImplementation(async (invoiceIds) => ({ id: `b-${invoiceIds[0]}` }) as any);

        const result = await service.generateBatchFromPdv({ status: S.SHIPPING });

        expect(generate.mock.calls.map((call) => call[0])).toEqual([
          ["inv-1", "inv-2"],
          ["inv-3"],
        ]);
        expect(result.batches).toEqual([{ id: "b-inv-1" }, { id: "b-inv-3" }]);
        expect(result.warnings).toEqual([]);
      });

      it("só a coluna: falha de uma transportadora vira aviso, as outras seguem", async () => {
        jest
          .spyOn(service, "generateBatchFromInvoices")
          .mockImplementation(async (invoiceIds) => {
            if (invoiceIds[0] === "inv-3") throw new Error("Nota(s) com produtos não mapeados: inv-3");
            return { id: "b-12" } as any;
          });

        const result = await service.generateBatchFromPdv({ status: S.SHIPPING });

        expect(result.batches).toEqual([{ id: "b-12" }]);
        expect(result.skipped).toEqual([
          expect.objectContaining({
            reason_code: PdvBatchSkipReason.FAILED,
            transporter_name: "ADT - CD 17",
            sales_request_ids: ["sr-3"],
            order_numbers: ["P3"],
          }),
        ]);
        expect(result.warnings).toEqual([
          "ADT - CD 17: Nota(s) com produtos não mapeados: inv-3",
        ]);
      });

      it("só a coluna: nota sem transportadora fica de fora com aviso", async () => {
        rows.push(row({ id: "sr-7", transporter_id: null, transporter_name: null }));
        jest.spyOn(service, "generateBatchFromInvoices").mockResolvedValue({ id: "b" } as any);

        const result = await service.generateBatchFromPdv({ status: S.SHIPPING });

        expect(result.warnings).toEqual([
          "Pedidos P7 sem transportadora na nota de venda — não foram processados.",
        ]);
      });

      it("nenhuma processada → erro, 1 grupo devolve a mensagem dele", async () => {
        jest
          .spyOn(service, "generateBatchFromInvoices")
          .mockRejectedValue(new Error("Nota(s) com produtos não mapeados: inv-6"));

        await expect(
          service.generateBatchFromPdv({ status: S.SHIP_TODAY, transporterId: "t-jadlog" }),
        ).rejects.toThrow("Nota(s) com produtos não mapeados: inv-6");
      });

      it("nenhuma candidata → mensagem amigável com etapa e coluna", async () => {
        await expect(
          service.generateBatchFromPdv({ status: S.SHIP_TODAY, transporterId: "t-outra" }),
        ).rejects.toThrow('Nenhuma solicitação sem lote em "Embarca hoje" da transportadora informada.');
      });

      it("escolhida já em lote → mensagem amigável (1 solicitação)", async () => {
        await expect(
          service.generateBatchFromPdv({ status: S.SHIPPING, salesRequestIds: ["sr-4"] }),
        ).rejects.toThrow("A solicitação do pedido P4 já está em um lote.");
      });

      it("várias escolhidas, parte já em lote → nem todas estão sem lote", async () => {
        await expect(
          service.generateBatchFromPdv({
            status: S.SHIPPING,
            cd: "12",
            salesRequestIds: ["sr-1", "sr-4", "sr-5"],
          }),
        ).rejects.toThrow(
          "Nem todas as solicitações estão sem lote. Já em lote: pedidos P4, P5.",
        );
      });

      it("só ids: escolhidas sem checar coluna/transportadora", async () => {
        const generate = jest
          .spyOn(service, "generateBatchFromInvoices")
          .mockResolvedValue({ id: "b" } as any);

        await service.generateBatchFromPdv({ status: "", salesRequestIds: ["sr-6"] });

        expect(generate).toHaveBeenCalledWith(["inv-6"], "cd21-id", "OUTGOING", "REGULAR");
      });
    });

    describe("adicionar a lote", () => {
      it("coluna + transportadora: lote pendente mais recente dela", async () => {
        (expeditionBatchRepository.findPendingOutgoingByTransporter as jest.Mock).mockResolvedValue([
          { id: "b-pending" },
        ]);
        const add = jest
          .spyOn(service, "addInvoiceToBatch")
          .mockResolvedValue({ id: "b-pending" } as any);

        const result = await service.addPdvToBatch({ status: S.SHIPPING, cd: "12" });

        expect(expeditionBatchRepository.findPendingOutgoingByTransporter).toHaveBeenCalledWith(
          "cd21-id",
          { cd: "12" },
          undefined,
        );
        expect(add).toHaveBeenCalledWith(["KEY-inv-1", "KEY-inv-2"], "cd21-id", "OUTGOING", "b-pending");
        expect(result).toEqual({ batches: [{ id: "b-pending" }], skipped: [], warnings: [] });
      });

      it("coluna + transportadora sem lote pendente → erro, nunca cria", async () => {
        (expeditionBatchRepository.findPendingOutgoingByTransporter as jest.Mock).mockResolvedValue([]);
        const add = jest.spyOn(service, "addInvoiceToBatch");

        await expect(
          service.addPdvToBatch({ status: S.SHIP_TODAY, transporterId: "t-jadlog" }),
        ).rejects.toThrow("Nenhum lote pendente da transportadora JADLOG no CD21. Gere um lote primeiro.");
        expect(add).not.toHaveBeenCalled();
      });

      it("batch_id fora dos pendentes da transportadora → erro", async () => {
        (expeditionBatchRepository.findPendingOutgoingByTransporter as jest.Mock).mockResolvedValue([]);

        await expect(
          service.addPdvToBatch({ status: S.SHIPPING, cd: "12", batchId: "b-x" }),
        ).rejects.toThrow("O lote escolhido não está mais pendente ou não é desta transportadora.");
      });

      it("só a coluna: distribui por transportadora e avisa as sem lote pendente", async () => {
        (expeditionBatchRepository.findPendingOutgoingByTransporter as jest.Mock).mockImplementation(
          async (_cd21: string, transporter: any) =>
            transporter.transporterId === "t-cd12" ? [{ id: "b-12" }] : [],
        );
        const add = jest
          .spyOn(service, "addInvoiceToBatch")
          .mockResolvedValue({ id: "b-12" } as any);

        const result = await service.addPdvToBatch({ status: S.SHIPPING });

        expect(expeditionBatchRepository.findPendingOutgoingByTransporter).toHaveBeenCalledWith(
          "cd21-id",
          { transporterId: "t-cd12" },
          undefined,
        );
        expect(add).toHaveBeenCalledTimes(1);
        expect(add).toHaveBeenCalledWith(["KEY-inv-1", "KEY-inv-2"], "cd21-id", "OUTGOING", "b-12");
        expect(result.batches).toEqual([{ id: "b-12" }]);
        expect(result.skipped).toEqual([
          expect.objectContaining({
            reason_code: PdvBatchSkipReason.NO_PENDING_BATCH,
            transporter_id: "t-cd17",
            transporter_name: "ADT - CD 17",
            sales_request_ids: ["sr-3"],
          }),
        ]);
        expect(result.warnings).toEqual([
          "Sem lote pendente no CD21 para as transportadoras: ADT - CD 17. Essas solicitações não foram adicionadas.",
        ]);
      });

      it("só a coluna, nenhuma transportadora com lote pendente → erro com a lista", async () => {
        (expeditionBatchRepository.findPendingOutgoingByTransporter as jest.Mock).mockResolvedValue([]);

        await expect(service.addPdvToBatch({ status: S.SHIPPING })).rejects.toThrow(
          "Sem lote pendente no CD21 para as transportadoras: ADT - CD 12, ADT - CD 17.",
        );
      });

      it("só a coluna + batch_id → pede seleção ou transportadora", async () => {
        await expect(
          service.addPdvToBatch({ status: S.SHIPPING, batchId: "b-1" }),
        ).rejects.toThrow("Para escolher o lote, selecione as solicitações ou informe a transportadora.");
      });

      it("escolhida já em lote → mensagem amigável", async () => {
        await expect(
          service.addPdvToBatch({ status: S.SHIPPING, salesRequestIds: ["sr-4"] }),
        ).rejects.toThrow("A solicitação do pedido P4 já está em um lote.");
      });

      it("só ids sem batch_id: último lote pendente do CD21 (ponteiro reconciliado)", async () => {
        const addLast = jest
          .spyOn(service, "addInvoiceToLastOutgoingBatch")
          .mockResolvedValue({ id: "b-last" } as any);

        const result = await service.addPdvToBatch({ status: "", salesRequestIds: ["sr-1"] });

        expect(unitBusinessService.getOrUpdateLastOutgoingBatchNumber).toHaveBeenCalledWith(
          "cd21-id",
        );
        expect(addLast).toHaveBeenCalledWith(["KEY-inv-1"], "cd21-id", "OUTGOING");
        expect(result.batches).toEqual([{ id: "b-last" }]);
        expect(expeditionBatchRepository.findPendingOutgoingByTransporter).not.toHaveBeenCalled();
      });

      it("só ids com batch_id: valida que é pendente de saída do CD21 (sem transportadora)", async () => {
        (expeditionBatchRepository.findPendingOutgoingByTransporter as jest.Mock).mockResolvedValue([
          { id: "b-chosen" },
        ]);
        const add = jest
          .spyOn(service, "addInvoiceToBatch")
          .mockResolvedValue({ id: "b-chosen" } as any);

        await service.addPdvToBatch({ status: "", salesRequestIds: ["sr-1"], batchId: "b-chosen" });

        expect(expeditionBatchRepository.findPendingOutgoingByTransporter).toHaveBeenCalledWith(
          "cd21-id",
          null,
          "b-chosen",
        );
        expect(add).toHaveBeenCalledWith(["KEY-inv-1"], "cd21-id", "OUTGOING", "b-chosen");
      });
    });

    describe("gerar romaneio", () => {
      beforeEach(() => {
        (batchInvoicesService.findBatchIdsByInvoiceIds as jest.Mock).mockImplementation(
          async (invoiceIds: string[]) =>
            new Map(invoiceIds.map((id) => [id, id === "inv-5" ? "b-fin" : "b-open"])),
        );
      });

      it("só a coluna: todas com lote finalizado sem romaneio, com o usuário logado", async () => {
        const generate = jest
          .spyOn(service, "generateDeliveryNote")
          .mockResolvedValue({ id: "b-fin" } as any);

        const result = await service.generateDeliveryNoteFromPdv({ status: S.SHIPPING }, "user-1");

        expect(batchInvoicesService.findBatchIdsByInvoiceIds).toHaveBeenCalledWith(
          ["inv-5"],
          "cd21-id",
        );
        expect(generate).toHaveBeenCalledWith("b-fin", "user-1");
        expect(result).toEqual({ batches: [{ id: "b-fin" }], skipped: [], warnings: [] });
      });

      it("nenhuma com lote finalizado → mensagem amigável", async () => {
        await expect(
          service.generateDeliveryNoteFromPdv({ status: S.SHIP_TODAY }, "user-1"),
        ).rejects.toThrow(
          'Nenhuma solicitação com lote finalizado aguardando romaneio em "Embarca hoje".',
        );
      });

      it("escolhidas só precisam estar em lote (finalizado ou não)", async () => {
        const generate = jest
          .spyOn(service, "generateDeliveryNote")
          .mockImplementation(async (batchId) => ({ id: batchId }) as any);

        const result = await service.generateDeliveryNoteFromPdv(
          { status: S.SHIPPING, salesRequestIds: ["sr-4", "sr-5"] },
          "user-1",
        );

        expect(generate.mock.calls.map((call) => call[0])).toEqual(["b-open", "b-fin"]);
        expect(result.batches).toHaveLength(2);
      });

      it("escolhida fora de lote → mensagem amigável", async () => {
        await expect(
          service.generateDeliveryNoteFromPdv(
            { status: S.SHIPPING, salesRequestIds: ["sr-1", "sr-2", "sr-5"] },
            "user-1",
          ),
        ).rejects.toThrow("Nem todas as solicitações estão em um lote. Sem lote: pedidos P1, P2.");
      });

      it("1 escolhida fora de lote → mensagem no singular", async () => {
        await expect(
          service.generateDeliveryNoteFromPdv(
            { status: S.SHIPPING, salesRequestIds: ["sr-1"] },
            "user-1",
          ),
        ).rejects.toThrow("A solicitação do pedido P1 ainda não está em um lote.");
      });
    });

    describe("pending-batches", () => {
      it("com transportadora: mesma resolução das ações", async () => {
        (expeditionBatchRepository.findPendingOutgoingByTransporter as jest.Mock).mockResolvedValue([
          { id: "b1" },
        ]);

        await expect(
          service.findPdvPendingBatches({ status: S.SHIP_TODAY, transporterId: "t-jadlog" }),
        ).resolves.toEqual([{ id: "b1" }]);
        expect(expeditionBatchRepository.findPendingOutgoingByTransporter).toHaveBeenCalledWith(
          "cd21-id",
          { transporterId: "t-jadlog" },
        );
      });

      it("sem cd/transporter_id: todos os pendentes do CD21", async () => {
        (expeditionBatchRepository.findPendingOutgoingByTransporter as jest.Mock).mockResolvedValue([]);

        await service.findPdvPendingBatches({ status: "" });

        expect(expeditionBatchRepository.findPendingOutgoingByTransporter).toHaveBeenCalledWith(
          "cd21-id",
          null,
        );
      });
    });
  });
});
