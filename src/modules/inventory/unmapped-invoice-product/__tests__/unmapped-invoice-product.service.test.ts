// Models (*.model.ts) são auto-mockados globalmente via src/__tests__/setup.ts
// (createModelMock — proxy que devolve jest.fn() pra qualquer método
// chamado). Não precisamos de jest.mock manual pros models aqui.

jest.mock("../../../handlers/uploader/services/uploader.service", () => ({
  __esModule: true,
  default: { upload: jest.fn(), delete: jest.fn() },
}));

jest.mock("../../../integrations/integrations/integrations.service", () => ({
  __esModule: true,
  default: { findById: jest.fn() },
}));

jest.mock("../../../../shared/utils/tecinco/resolve-branch-id", () => ({
  __esModule: true,
  resolveTecincoBranchId: jest.fn(),
}));

// BlingApiFetchQueue/TCarUpsertQueue só são usados como tipo aqui (os
// objetos passados nos testes são mocks simples) — mocka-se o módulo pra
// não arrastar o grafo de dependências pesado dos dois arquivos reais.
jest.mock(
  "../../../handlers/bling/services/bling/queues/bling-api-fetch.queue",
  () => ({ __esModule: true, BlingApiFetchQueue: class {} }),
);
jest.mock("../../../handlers/tecinco/queues/tecinco-api-fetch.queue", () => ({
  __esModule: true,
  TCarUpsertQueue: class {},
}));

import UnmappedInvoiceProduct from "../unmapped-invoice-product.model";
import integrationsService from "../../../integrations/integrations/integrations.service";
import { resolveTecincoBranchId } from "../../../../shared/utils/tecinco/resolve-branch-id";
import { UnmappedInvoiceProductService } from "../unmapped-invoice-product.service";

describe("UnmappedInvoiceProductService", () => {
  let service: UnmappedInvoiceProductService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new UnmappedInvoiceProductService();
  });

  // ─── resolveFromCreatedProduct ──────────────────────────────────────────
  // Único efeito colateral esperado: apagar a linha unmapped de catálogo
  // que originou a criação. Nunca cria invoice item nem toca em notas —
  // isso é responsabilidade exclusiva do mapeamento manual (POST /add/item).

  describe("resolveFromCreatedProduct", () => {
    it("apaga a linha unmapped de catálogo encontrada por external_id+integrations_id", async () => {
      (UnmappedInvoiceProduct.findOne as jest.Mock).mockResolvedValue({
        id: "unmapped-catalog-id",
        invoice_id: null,
      });
      const deleteSpy = jest
        .spyOn(service, "delete")
        .mockResolvedValue(undefined as any);

      await service.resolveFromCreatedProduct({
        externalId: "90001",
        integrationsId: "integration-1",
      });

      expect(UnmappedInvoiceProduct.findOne).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            external_id: "90001",
            integrations_id: "integration-1",
            status: "UNMAPPED",
          }),
        }),
      );
      expect(deleteSpy).toHaveBeenCalledWith("unmapped-catalog-id");
    });

    it("nenhum unmapped encontrado (já foi resolvido/apagado antes) — não lança erro, não tenta apagar nada", async () => {
      (UnmappedInvoiceProduct.findOne as jest.Mock).mockResolvedValue(null);

      await expect(
        service.resolveFromCreatedProduct({
          externalId: "90001",
          integrationsId: "integration-1",
        }),
      ).resolves.toBeUndefined();
    });
  });

  // ─── findCascadeMatches ──────────────────────────────────────────────────
  // Usado pela cascata do mapeamento manual (InvoiceItemsService) — só deve
  // considerar "match seguro" quando o CNPJ emissor bate (normalizado),
  // mesmo que formatado diferente (com/sem pontuação).

  describe("findCascadeMatches", () => {
    it("sem supplierProductCode: retorna [] sem consultar o repository", async () => {
      const result = await service.findCascadeMatches({
        supplierProductCode: null,
        excludeId: "x",
        senderCnpj: "11.222.333/0001-44",
      });

      expect(result).toEqual([]);
    });

    it("filtra só os candidatos cujo CNPJ emissor bate (normalizado) com o informado", async () => {
      jest
        .spyOn((service as any).repository, "findByCodeExcluding")
        .mockResolvedValue([
          { id: "match-same-cnpj", invoice: { sender_cnpj: "11222333000144" } },
          {
            id: "match-different-cnpj",
            invoice: { sender_cnpj: "99888777000111" },
          },
          {
            id: "match-same-cnpj-formatted",
            invoice: { sender_cnpj: "11.222.333/0001-44" },
          },
        ]);

      const result = await service.findCascadeMatches({
        supplierProductCode: "COD-1",
        excludeId: "origin-id",
        senderCnpj: "11.222.333/0001-44",
      });

      expect(result.map((r: any) => r.id)).toEqual([
        "match-same-cnpj",
        "match-same-cnpj-formatted",
      ]);
    });

    it("candidato sem invoice (dado inconsistente): trata sender_cnpj como vazio, não bate com nenhum CNPJ real", async () => {
      jest
        .spyOn((service as any).repository, "findByCodeExcluding")
        .mockResolvedValue([{ id: "match-no-invoice", invoice: null }]);

      const result = await service.findCascadeMatches({
        supplierProductCode: "COD-1",
        excludeId: "origin-id",
        senderCnpj: "11222333000144",
      });

      expect(result).toEqual([]);
    });
  });

  // ─── createProduct ───────────────────────────────────────────────────────
  // Único disparador (manual) da criação de produto a partir de unmapped.

  describe("createProduct", () => {
    const baseUnmapped = {
      id: "unmapped-1",
      external_id: "90001",
      integrations_id: "integration-1",
      product_name: "Pneu Aro 14",
    };

    it("unmapped não encontrado: lança erro claro", async () => {
      jest.spyOn(service, "findById").mockResolvedValue(null as any);

      await expect(
        service.createProduct("nao-existe", {
          blingApiFetchQueue: { add: jest.fn() } as any,
          tcarUpsertQueue: { add: jest.fn() } as any,
        }),
      ).rejects.toThrow(/não encontrado/i);
    });

    it("unmapped sem external_id: lança erro claro, não chama integrationsService nem enfileira nada", async () => {
      jest
        .spyOn(service, "findById")
        .mockResolvedValue({ ...baseUnmapped, external_id: null } as any);
      const blingQueue = { add: jest.fn() };

      await expect(
        service.createProduct("unmapped-1", {
          blingApiFetchQueue: blingQueue as any,
          tcarUpsertQueue: { add: jest.fn() } as any,
        }),
      ).rejects.toThrow(/não tem id do ERP/i);

      expect(integrationsService.findById).not.toHaveBeenCalled();
      expect(blingQueue.add).not.toHaveBeenCalled();
    });

    it("integração não encontrada: lança erro claro", async () => {
      jest.spyOn(service, "findById").mockResolvedValue(baseUnmapped as any);
      (integrationsService.findById as jest.Mock).mockResolvedValue(null);

      await expect(
        service.createProduct("unmapped-1", {
          blingApiFetchQueue: { add: jest.fn() } as any,
          tcarUpsertQueue: { add: jest.fn() } as any,
        }),
      ).rejects.toThrow(/integração.*não encontrada/i);
    });

    it("integração não suportada (nem Bling nem Tecinco): lança erro claro, não enfileira", async () => {
      jest.spyOn(service, "findById").mockResolvedValue(baseUnmapped as any);
      (integrationsService.findById as jest.Mock).mockResolvedValue({
        id: "integration-1",
        name: "Magento",
      });
      const blingQueue = { add: jest.fn() };
      const tcarQueue = { add: jest.fn() };

      await expect(
        service.createProduct("unmapped-1", {
          blingApiFetchQueue: blingQueue as any,
          tcarUpsertQueue: tcarQueue as any,
        }),
      ).rejects.toThrow(/não suportada/i);

      expect(blingQueue.add).not.toHaveBeenCalled();
      expect(tcarQueue.add).not.toHaveBeenCalled();
    });

    it("Bling: enfileira com create:true, blingId numérico e prioridade máxima (1)", async () => {
      jest.spyOn(service, "findById").mockResolvedValue(baseUnmapped as any);
      (integrationsService.findById as jest.Mock).mockResolvedValue({
        id: "integration-1",
        name: "Bling",
      });
      const blingQueue = { add: jest.fn().mockResolvedValue(undefined) };

      await service.createProduct("unmapped-1", {
        blingApiFetchQueue: blingQueue as any,
        tcarUpsertQueue: { add: jest.fn() } as any,
      });

      expect(blingQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: "product",
          apiFetch: expect.objectContaining({
            blingId: 90001,
            create: true,
          }),
        }),
        `bling-product-create-${baseUnmapped.id}`,
        expect.objectContaining({ priority: 1, removeOnComplete: expect.any(Object) }),
      );
    });

    it("Tecinco: resolve a filial do usuário, monta payload mínimo e enfileira com create:true e prioridade máxima", async () => {
      jest.spyOn(service, "findById").mockResolvedValue(baseUnmapped as any);
      (integrationsService.findById as jest.Mock).mockResolvedValue({
        id: "integration-1",
        name: "Tecinco",
      });
      (resolveTecincoBranchId as jest.Mock).mockResolvedValue(3);
      const tcarQueue = { add: jest.fn().mockResolvedValue(undefined) };

      await service.createProduct("unmapped-1", {
        blingApiFetchQueue: { add: jest.fn() } as any,
        tcarUpsertQueue: tcarQueue as any,
        userId: "user-1",
      });

      expect(resolveTecincoBranchId).toHaveBeenCalledWith("user-1");
      expect(tcarQueue.add).toHaveBeenCalledWith(
        expect.objectContaining({
          resource: "product",
          branchId: 3,
          create: true,
          data: expect.objectContaining({
            fll_codigo: 3,
            epctb_codigo: "90001",
          }),
        }),
        `tecinco-product-create-${baseUnmapped.id}`,
        expect.objectContaining({ priority: 1, removeOnComplete: expect.any(Object) }),
      );
    });

    it("Tecinco: não é possível resolver a filial do usuário — lança erro claro, não enfileira", async () => {
      jest.spyOn(service, "findById").mockResolvedValue(baseUnmapped as any);
      (integrationsService.findById as jest.Mock).mockResolvedValue({
        id: "integration-1",
        name: "Tecinco",
      });
      (resolveTecincoBranchId as jest.Mock).mockResolvedValue(undefined);
      const tcarQueue = { add: jest.fn() };

      await expect(
        service.createProduct("unmapped-1", {
          blingApiFetchQueue: { add: jest.fn() } as any,
          tcarUpsertQueue: tcarQueue as any,
        }),
      ).rejects.toThrow(/filial/i);

      expect(tcarQueue.add).not.toHaveBeenCalled();
    });
  });

  // ─── getCreateProductJobStatus ──────────────────────────────────────────
  // Status do job enfileirado por createProduct — usado pro front dar
  // polling. jobIds são determinísticos (um por integração, baseados no id
  // do unmapped), então a busca tenta os dois sem precisar saber qual
  // integração foi usada.

  describe("getCreateProductJobStatus", () => {
    function makeJob(overrides: Partial<any> = {}) {
      return {
        getState: jest.fn().mockResolvedValue("completed"),
        failedReason: undefined,
        ...overrides,
      };
    }

    it("nenhum job encontrado em nenhuma das duas filas: status not_found", async () => {
      const blingQueue = { queue: { getJob: jest.fn().mockResolvedValue(null) } };
      const tcarQueue = { queue: { getJob: jest.fn().mockResolvedValue(null) } };

      const result = await service.getCreateProductJobStatus("unmapped-1", {
        blingApiFetchQueue: blingQueue as any,
        tcarUpsertQueue: tcarQueue as any,
      });

      expect(result).toEqual({ status: "not_found" });
      expect(blingQueue.queue.getJob).toHaveBeenCalledWith(
        "bling-product-create-unmapped-1",
      );
      expect(tcarQueue.queue.getJob).toHaveBeenCalledWith(
        "tecinco-product-create-unmapped-1",
      );
    });

    it("job encontrado na fila Bling, completado com sucesso: status completed", async () => {
      const job = makeJob({ getState: jest.fn().mockResolvedValue("completed") });
      const blingQueue = { queue: { getJob: jest.fn().mockResolvedValue(job) } };
      const tcarQueue = { queue: { getJob: jest.fn().mockResolvedValue(null) } };

      const result = await service.getCreateProductJobStatus("unmapped-1", {
        blingApiFetchQueue: blingQueue as any,
        tcarUpsertQueue: tcarQueue as any,
      });

      expect(result).toEqual({ status: "completed" });
    });

    it("job encontrado na fila Tecinco (Bling não achou), falhou: status failed com a mensagem de erro", async () => {
      const job = makeJob({
        getState: jest.fn().mockResolvedValue("failed"),
        failedReason: "gtin já pertence a outro produto",
      });
      const blingQueue = { queue: { getJob: jest.fn().mockResolvedValue(null) } };
      const tcarQueue = { queue: { getJob: jest.fn().mockResolvedValue(job) } };

      const result = await service.getCreateProductJobStatus("unmapped-1", {
        blingApiFetchQueue: blingQueue as any,
        tcarUpsertQueue: tcarQueue as any,
      });

      expect(result).toEqual({
        status: "failed",
        error: "gtin já pertence a outro produto",
      });
    });

    it("job ainda pendente (waiting/active/delayed): repassa o estado como está", async () => {
      for (const state of ["waiting", "active", "delayed"] as const) {
        const job = makeJob({ getState: jest.fn().mockResolvedValue(state) });
        const blingQueue = { queue: { getJob: jest.fn().mockResolvedValue(job) } };
        const tcarQueue = { queue: { getJob: jest.fn().mockResolvedValue(null) } };

        const result = await service.getCreateProductJobStatus("unmapped-1", {
          blingApiFetchQueue: blingQueue as any,
          tcarUpsertQueue: tcarQueue as any,
        });

        expect(result).toEqual({ status: state });
      }
    });

    it("job com priority explícita ainda não pego por um worker: BullMQ reporta 'prioritized', repassado como 'waiting' pro front", async () => {
      const job = makeJob({ getState: jest.fn().mockResolvedValue("prioritized") });
      const blingQueue = { queue: { getJob: jest.fn().mockResolvedValue(job) } };
      const tcarQueue = { queue: { getJob: jest.fn().mockResolvedValue(null) } };

      const result = await service.getCreateProductJobStatus("unmapped-1", {
        blingApiFetchQueue: blingQueue as any,
        tcarUpsertQueue: tcarQueue as any,
      });

      expect(result).toEqual({ status: "waiting" });
    });
  });
});
