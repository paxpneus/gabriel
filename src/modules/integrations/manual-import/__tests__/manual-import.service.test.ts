// Fluxo completo (busca/escolha/andamento) com handler e filas falsos e Redis em memória.
jest.mock("../../../../shared/utils/base-models/base-redis", () => {
  const { createFakeRedis } = jest.requireActual("./helpers/fake-redis");
  return { __esModule: true, default: createFakeRedis() };
});
jest.mock("../manual-import.resolver", () => ({
  __esModule: true,
  resolveManualImportHandler: jest.fn(),
  listManualImportHandlers: jest.fn(),
}));
jest.mock("../../../company/users/users/user.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));
jest.mock("../../applications/applications.service", () => ({
  __esModule: true,
  default: { findAll: jest.fn() },
}));

import redisService from "../../../../shared/utils/base-models/base-redis";
import userService from "../../../company/users/users/user.service";
import applicationService from "../../applications/applications.service";
import {
  listManualImportHandlers,
  resolveManualImportHandler,
} from "../manual-import.resolver";
import { ManualImportService } from "../manual-import.service";
import { ManualImportError } from "../manual-import.errors";
import { manualImportKeys } from "../manual-import.constants";
import {
  ManualImportFoundItem,
  ManualImportRun,
} from "../manual-import.types";

// uuid é mockado globalmente (src/__tests__/setup.ts): todo runId novo é "mock-uuid".
const RUN_ID = "mock-uuid";
const INTEGRATION_ID = "integration-1";
const requester = { id: "user-1", type: "user" as const };
const otherUser = { id: "user-2", type: "user" as const };

const fakeRedis = redisService as unknown as {
  store: Map<string, string>;
};

function makeJob(state: string, extra: Record<string, unknown> = {}) {
  return { getState: jest.fn().mockResolvedValue(state), ...extra };
}

function makeQueue() {
  const jobs = new Map<string, any>();
  return {
    jobs,
    add: jest.fn(async (_data: unknown, jobId: string) => {
      jobs.set(jobId, makeJob("prioritized"));
    }),
    getJob: jest.fn(async (jobId: string) => jobs.get(jobId) ?? null),
    hasPendingJobsNamed: jest.fn().mockResolvedValue(false),
  };
}

function makeQueues() {
  return {
    blingApiFetch: makeQueue(),
    blingOrder: makeQueue(),
    tcarApiFetch: makeQueue(),
    tcarInvoice: makeQueue(),
  };
}

function makeHandler() {
  return {
    getIntegration: jest.fn().mockResolvedValue({ id: INTEGRATION_ID }),
    supportedSearches: { product: ["id", "name"], order: ["id", "number"] },
    localIdSearchBy: { product: "id", order: "id" },
    queueKeys: ["blingApiFetch", "blingOrder"],
    queueFor: (entity: string) => (entity === "order" ? "blingOrder" : "blingApiFetch"),
    search: jest.fn(),
    findLocalIds: jest.fn().mockResolvedValue(new Map()),
    findExternalIdByLocalId: jest.fn(),
    enqueue: jest.fn(async (_entity, item, jobRef, queues) => {
      await queues[jobRef.queue].add({ id: item.externalId }, jobRef.jobId);
    }),
  };
}

function found(externalId: string, extra: Partial<ManualImportFoundItem> = {}): ManualImportFoundItem {
  return {
    externalId,
    label: `Item ${externalId}`,
    details: { name: `Produto ${externalId}`, ean: null, code: null, status: null },
    importable: true,
    enqueueData: { ref: externalId },
    ...extra,
  };
}

function seedClaim(
  entity: "product" | "order",
  externalId: string,
  claim: { runId: string; requestedBy: { id: string; type: string }; jobRef: { queue: string; jobId: string } },
) {
  fakeRedis.store.set(
    manualImportKeys.itemClaim(INTEGRATION_ID, entity, externalId),
    JSON.stringify(claim),
  );
}

function seedSearch(entity: "product" | "order", externalId: string, extra: Record<string, unknown> = {}) {
  fakeRedis.store.set(
    manualImportKeys.search(requester.id, INTEGRATION_ID, entity, externalId),
    JSON.stringify({
      externalId,
      label: `Item ${externalId}`,
      importable: true,
      existsLocally: false,
      localId: null,
      enqueueData: { ref: externalId },
      ...extra,
    }),
  );
}

function seedRun(run: ManualImportRun, lockOwner = run.runId) {
  fakeRedis.store.set(manualImportKeys.userLock(run.requestedBy.id), lockOwner);
  fakeRedis.store.set(manualImportKeys.userRun(run.requestedBy.id), JSON.stringify(run));
}

function runningRun(items: Array<{ externalId: string; jobId: string }>, runId = "old-run"): ManualImportRun {
  return {
    runId,
    status: "RUNNING",
    integrationId: INTEGRATION_ID,
    entity: "order",
    requestedBy: requester,
    startedAt: "2026-10-15T10:00:00.000Z",
    items: items.map(({ externalId, jobId }) => ({
      externalId,
      label: `Item ${externalId}`,
      existsLocally: false,
      jobRef: { queue: "blingOrder", jobId },
    })),
  };
}

async function expectManualImportError(promise: Promise<unknown>, httpStatus: number, code: string) {
  const error = await promise.then(
    () => null,
    (err) => err,
  );
  expect(error).toBeInstanceOf(ManualImportError);
  expect(error.httpStatus).toBe(httpStatus);
  expect(error.body.code).toBe(code);
  return error as ManualImportError;
}

describe("ManualImportService", () => {
  let service: ManualImportService;
  let handler: ReturnType<typeof makeHandler>;
  let queues: ReturnType<typeof makeQueues>;

  beforeEach(() => {
    fakeRedis.store.clear();
    service = new ManualImportService();
    handler = makeHandler();
    queues = makeQueues();
    (resolveManualImportHandler as jest.Mock).mockResolvedValue(handler);
    (listManualImportHandlers as jest.Mock).mockResolvedValue([
      { handler, integrationId: INTEGRATION_ID },
    ]);
    (userService.findAll as jest.Mock).mockResolvedValue([{ id: "user-2", name: "Maria" }]);
    (applicationService.findAll as jest.Mock).mockResolvedValue([]);
  });

  describe("search", () => {
    const search = (by: string, value: string, entity = "product") =>
      service.search(
        { integrationId: INTEGRATION_ID, entity: entity as any, by: by as any, value },
        requester,
        queues as any,
      );

    it("0 resultados: NOT_FOUND, nada enfileirado", async () => {
      handler.search.mockResolvedValue({ items: [], truncated: false });

      const result = await search("name", "pneu");

      expect(result).toEqual({ httpStatus: 200, body: { outcome: "NOT_FOUND" } });
      expect(queues.blingApiFetch.add).not.toHaveBeenCalled();
    });

    it("1 resultado novo: enfileira direto, sem aviso de atualização", async () => {
      handler.search.mockResolvedValue({ items: [found("10")], truncated: false });

      const result = await search("id", "10");

      expect(result.httpStatus).toBe(202);
      expect(result.body).toMatchObject({
        outcome: "ENQUEUED",
        item: { externalId: "10", status: "ENQUEUED", details: { name: "Produto 10" } },
        run: { runId: RUN_ID, status: "RUNNING", total: 1, done: 0 },
        warnings: [],
      });
      expect(queues.blingApiFetch.add).toHaveBeenCalledWith(
        { id: "10" },
        `manual-import-product-10-${RUN_ID}`,
      );
      expect(fakeRedis.store.get(manualImportKeys.userLock(requester.id))).toBe(RUN_ID);
    });

    it("1 resultado já existente: enfileira com ALREADY_EXISTS_UPDATING", async () => {
      handler.search.mockResolvedValue({ items: [found("10")], truncated: false });
      handler.findLocalIds.mockResolvedValue(new Map([["10", "local-10"]]));

      const result = await search("id", "10");

      expect(result.httpStatus).toBe(202);
      expect(result.body.warnings).toEqual([
        expect.objectContaining({
          code: "ALREADY_EXISTS_UPDATING",
          message: "Registro já existente no sistema, atualizando",
        }),
      ]);
      expect((result.body.run as any).items[0].existsLocally).toBe(true);
    });

    it("1 resultado já em import de outra pessoa: NOT_ENQUEUED e o lock do usuário é solto", async () => {
      handler.search.mockResolvedValue({ items: [found("10")], truncated: false });
      queues.blingApiFetch.jobs.set("job-other", makeJob("active"));
      seedClaim("product", "10", {
        runId: "other-run",
        requestedBy: otherUser,
        jobRef: { queue: "blingApiFetch", jobId: "job-other" },
      });

      const result = await search("id", "10");

      expect(result).toEqual({
        httpStatus: 200,
        body: {
          outcome: "NOT_ENQUEUED",
          item: expect.objectContaining({
            status: "ALREADY_PROCESSING",
            processingBy: { id: "user-2", type: "user", name: "Maria" },
          }),
        },
      });
      expect(queues.blingApiFetch.add).not.toHaveBeenCalled();
      expect(fakeRedis.store.has(manualImportKeys.userLock(requester.id))).toBe(false);
    });

    it("N resultados: CHOOSE com existsLocally por item, nada enfileirado e cache gravado", async () => {
      handler.search.mockResolvedValue({
        items: [found("1"), found("2"), found("3")],
        truncated: true,
      });
      handler.findLocalIds.mockResolvedValue(new Map([["2", "local-2"]]));

      const result = await search("name", "pneu");

      expect(handler.findLocalIds).toHaveBeenCalledTimes(1);
      expect(handler.findLocalIds).toHaveBeenCalledWith("product", ["1", "2", "3"]);
      expect(result.httpStatus).toBe(200);
      expect(result.body.outcome).toBe("CHOOSE");
      expect(result.body.truncated).toBe(true);
      expect(
        (result.body.results as any[]).map((r) => [r.externalId, r.existsLocally, r.localId]),
      ).toEqual([
        ["1", false, null],
        ["2", true, "local-2"],
        ["3", false, null],
      ]);
      expect(queues.blingApiFetch.add).not.toHaveBeenCalled();
      expect(fakeRedis.store.has(manualImportKeys.userLock(requester.id))).toBe(false);

      const cached = JSON.parse(
        fakeRedis.store.get(
          manualImportKeys.search(requester.id, INTEGRATION_ID, "product", "2"),
        )!,
      );
      expect(cached).toMatchObject({
        externalId: "2",
        existsLocally: true,
        localId: "local-2",
        enqueueData: { ref: "2" },
      });
    });

    it("N resultados: item com claim vivo de outra pessoa vem com alreadyProcessing", async () => {
      handler.search.mockResolvedValue({ items: [found("1"), found("2")], truncated: false });
      queues.blingApiFetch.jobs.set("job-other", makeJob("delayed"));
      seedClaim("product", "2", {
        runId: "other-run",
        requestedBy: otherUser,
        jobRef: { queue: "blingApiFetch", jobId: "job-other" },
      });

      const result = await search("name", "pneu");

      const results = result.body.results as any[];
      expect(results[0].alreadyProcessing).toBeNull();
      expect(results[1].alreadyProcessing).toEqual({ id: "user-2", type: "user", name: "Maria" });
    });

    it("usuário com import rodando: 409 antes de chamar a API", async () => {
      queues.blingOrder.jobs.set("job-running", makeJob("active"));
      seedRun(runningRun([{ externalId: "5", jobId: "job-running" }]));

      const error = await expectManualImportError(search("id", "10"), 409, "USER_IMPORT_RUNNING");

      expect(error.body.run).toMatchObject({ runId: "old-run", status: "RUNNING" });
      expect(handler.search).not.toHaveBeenCalled();
    });

    it("by não suportado pra entidade: 400", async () => {
      await expectManualImportError(search("number", "123"), 400, "UNSUPPORTED_SEARCH");
      await expectManualImportError(search("id", "1", "invoice"), 400, "UNSUPPORTED_SEARCH");
      expect(handler.search).not.toHaveBeenCalled();
    });

    it("integração sem handler: 400", async () => {
      (resolveManualImportHandler as jest.Mock).mockResolvedValue(null);

      await expectManualImportError(search("id", "1"), 400, "INTEGRATION_NOT_SUPPORTED");
    });

    it("local_id sem vínculo com a integração: 422", async () => {
      handler.findExternalIdByLocalId.mockResolvedValue(null);

      await expectManualImportError(
        search("local_id", "9d2f6a3e-0000-4000-8000-000000000000"),
        422,
        "LOCAL_RECORD_NOT_LINKED",
      );
      expect(handler.search).not.toHaveBeenCalled();
    });

    it("local_id vinculado: refaz a busca pelo id externo", async () => {
      handler.findExternalIdByLocalId.mockResolvedValue("ext-9");
      handler.search.mockResolvedValue({ items: [], truncated: false });

      await search("local_id", "9d2f6a3e-0000-4000-8000-000000000000");

      expect(handler.search).toHaveBeenCalledWith("product", "id", "ext-9");
    });

    it("aviso OTHER_MANUAL_IMPORTS_RUNNING quando há job manual-import pendente na integração", async () => {
      handler.search.mockResolvedValue({ items: [found("1"), found("2")], truncated: false });
      queues.blingOrder.hasPendingJobsNamed.mockResolvedValue(true);

      const result = await search("name", "pneu");

      expect(queues.blingOrder.hasPendingJobsNamed).toHaveBeenCalledWith(["manual-import"]);
      expect(result.body.warnings).toEqual([
        expect.objectContaining({ code: "OTHER_MANUAL_IMPORTS_RUNNING" }),
      ]);
    });
  });

  describe("confirm", () => {
    const confirm = (externalIds: string[], entity = "order") =>
      service.confirm(
        { integrationId: INTEGRATION_ID, entity: entity as any, externalIds },
        requester,
        queues as any,
      );

    it("mais de 10 ids: 400 MAX_ITEMS_EXCEEDED", async () => {
      const ids = Array.from({ length: 11 }, (_, i) => String(i + 1));

      const error = await expectManualImportError(confirm(ids), 400, "MAX_ITEMS_EXCEEDED");

      expect(error.body.max).toBe(10);
      expect(resolveManualImportHandler).not.toHaveBeenCalled();
    });

    it("usuário com import rodando: 409", async () => {
      queues.blingOrder.jobs.set("job-running", makeJob("waiting"));
      seedRun(runningRun([{ externalId: "5", jobId: "job-running" }]));
      seedSearch("order", "1");

      await expectManualImportError(confirm(["1"]), 409, "USER_IMPORT_RUNNING");
      expect(queues.blingOrder.add).not.toHaveBeenCalled();
    });

    it("import anterior já terminou: solta o lock e segue", async () => {
      queues.blingOrder.jobs.set("job-done", makeJob("completed"));
      seedRun(runningRun([{ externalId: "5", jobId: "job-done" }]));
      seedSearch("order", "1");

      const result = await confirm(["1"]);

      expect(result.httpStatus).toBe(202);
      expect(fakeRedis.store.get(manualImportKeys.userLock(requester.id))).toBe(RUN_ID);
      expect(queues.blingOrder.add).toHaveBeenCalledTimes(1);
    });

    it("id fora do cache: SEARCH_EXPIRED, os outros seguem", async () => {
      seedSearch("order", "1");

      const result = await confirm(["1", "2"]);

      expect(result.httpStatus).toBe(202);
      expect((result.body.items as any[]).map((i) => [i.externalId, i.status])).toEqual([
        ["1", "ENQUEUED"],
        ["2", "SEARCH_EXPIRED"],
      ]);
    });

    it("nenhum item no cache: 200 sem import e sem lock", async () => {
      const result = await confirm(["1"]);

      expect(result.httpStatus).toBe(200);
      expect(result.body.run).toBeUndefined();
      expect(fakeRedis.store.has(manualImportKeys.userLock(requester.id))).toBe(false);
    });

    it("pedidos 1, 2 e 3 com o 1 em claim de outra pessoa: 1 ALREADY_PROCESSING, 2 e 3 ENQUEUED", async () => {
      ["1", "2", "3"].forEach((id) => seedSearch("order", id));
      queues.blingOrder.jobs.set("job-other", makeJob("active"));
      seedClaim("order", "1", {
        runId: "other-run",
        requestedBy: otherUser,
        jobRef: { queue: "blingOrder", jobId: "job-other" },
      });

      const result = await confirm(["1", "2", "3"]);

      expect(result.httpStatus).toBe(202);
      const items = result.body.items as any[];
      expect(items.map((i) => [i.externalId, i.status])).toEqual([
        ["1", "ALREADY_PROCESSING"],
        ["2", "ENQUEUED"],
        ["3", "ENQUEUED"],
      ]);
      expect(items[0].processingBy).toEqual({ id: "user-2", type: "user", name: "Maria" });
      expect(queues.blingOrder.add).toHaveBeenCalledTimes(2);
      expect((result.body.run as any).total).toBe(2);
    });

    it("claim cujo job já terminou é sobra de import anterior: sobrescreve e enfileira", async () => {
      seedSearch("order", "1");
      queues.blingOrder.jobs.set("job-old", makeJob("failed", { failedReason: "x" }));
      seedClaim("order", "1", {
        runId: "other-run",
        requestedBy: otherUser,
        jobRef: { queue: "blingOrder", jobId: "job-old" },
      });

      const result = await confirm(["1"]);

      expect((result.body.items as any[])[0].status).toBe("ENQUEUED");
      const claim = JSON.parse(
        fakeRedis.store.get(manualImportKeys.itemClaim(INTEGRATION_ID, "order", "1"))!,
      );
      expect(claim).toEqual({
        runId: RUN_ID,
        requestedBy: requester,
        jobRef: { queue: "blingOrder", jobId: `manual-import-order-1-${RUN_ID}` },
      });
    });

    it("item existente volta com ALREADY_EXISTS_UPDATING; não importável volta NOT_IMPORTABLE", async () => {
      seedSearch("order", "1", { existsLocally: true, localId: "local-1" });
      seedSearch("order", "2", { importable: false, reason: "Nota anterior ao corte" });

      const result = await confirm(["1", "2"]);

      const items = result.body.items as any[];
      expect(items[0]).toMatchObject({
        status: "ENQUEUED",
        warnings: [expect.objectContaining({ code: "ALREADY_EXISTS_UPDATING" })],
      });
      expect(items[1]).toMatchObject({ status: "NOT_IMPORTABLE", reason: "Nota anterior ao corte" });
    });

    it("warnings OTHER_MANUAL_IMPORTS_RUNNING quando há job manual-import pendente", async () => {
      seedSearch("order", "1");
      queues.blingApiFetch.hasPendingJobsNamed.mockResolvedValue(true);

      const result = await confirm(["1"]);

      expect(result.body.warnings).toEqual([
        expect.objectContaining({ code: "OTHER_MANUAL_IMPORTS_RUNNING" }),
      ]);
    });
  });

  describe("getStatus", () => {
    it("done/total a partir do estado dos jobs; prioritized conta como waiting", async () => {
      queues.blingOrder.jobs.set("job-1", makeJob("completed", { returnvalue: "IGNORED_NO_TIRE_ITEMS" }));
      queues.blingOrder.jobs.set("job-2", makeJob("failed", { failedReason: "Bling respondeu 500" }));
      queues.blingOrder.jobs.set("job-3", makeJob("prioritized"));
      seedRun(
        runningRun([
          { externalId: "1", jobId: "job-1" },
          { externalId: "2", jobId: "job-2" },
          { externalId: "3", jobId: "job-3" },
        ]),
      );

      const status = await service.getStatus(requester, queues as any);

      expect(status.maxItems).toBe(10);
      expect(status.othersRunning).toEqual({ [INTEGRATION_ID]: false });
      expect(status.run).toMatchObject({
        status: "RUNNING",
        total: 3,
        done: 2,
        completed: 1,
        failed: 1,
      });
      expect(status.run!.items).toEqual([
        expect.objectContaining({ status: "completed", result: "IGNORED_NO_TIRE_ITEMS" }),
        expect.objectContaining({ status: "failed", error: "Bling respondeu 500" }),
        expect.objectContaining({ status: "waiting" }),
      ]);
      expect(fakeRedis.store.get(manualImportKeys.userLock(requester.id))).toBe("old-run");
    });

    it("tudo finalizado: FINISHED, solta lock e claims — mas não o claim já sobrescrito por outro runId", async () => {
      queues.blingOrder.jobs.set("job-1", makeJob("completed"));
      // job-2 sumiu do Redis: conta como finalizado (not_found).
      const run = runningRun([
        { externalId: "1", jobId: "job-1" },
        { externalId: "2", jobId: "job-2" },
      ]);
      seedRun(run);
      seedClaim("order", "1", {
        runId: "old-run",
        requestedBy: requester,
        jobRef: { queue: "blingOrder", jobId: "job-1" },
      });
      seedClaim("order", "2", {
        runId: "newer-run",
        requestedBy: otherUser,
        jobRef: { queue: "blingOrder", jobId: "job-newer" },
      });

      const status = await service.getStatus(requester, queues as any);

      expect(status.run).toMatchObject({ status: "FINISHED", total: 2, done: 2, completed: 1, failed: 1 });
      expect(status.run!.items[0]).toMatchObject({ status: "completed", result: "IMPORTED" });
      expect(status.run!.items[1]).toMatchObject({ status: "not_found" });
      expect(fakeRedis.store.has(manualImportKeys.userLock(requester.id))).toBe(false);
      expect(fakeRedis.store.has(manualImportKeys.itemClaim(INTEGRATION_ID, "order", "1"))).toBe(false);
      expect(fakeRedis.store.has(manualImportKeys.itemClaim(INTEGRATION_ID, "order", "2"))).toBe(true);

      const stored = JSON.parse(fakeRedis.store.get(manualImportKeys.userRun(requester.id))!);
      expect(stored.status).toBe("FINISHED");
      expect(stored.finishedAt).toBeDefined();
    });

    it("sem import registrado: run null", async () => {
      const status = await service.getStatus(requester, queues as any);

      expect(status.run).toBeNull();
    });
  });
});
