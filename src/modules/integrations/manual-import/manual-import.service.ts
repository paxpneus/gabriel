import redisService from "../../../shared/utils/base-models/base-redis";
import type { Requester } from "../../../middlewares/auth-token";
import { ManualImportError } from "./manual-import.errors";
import {
  MANUAL_IMPORT_ENTITY_LABELS,
  MANUAL_IMPORT_MAX_ITEMS,
  MANUAL_IMPORT_SEARCH_BY_LABELS,
  MANUAL_IMPORT_SEARCH_TTL_S,
  MANUAL_IMPORT_WARNINGS,
  manualImportKeys,
} from "./manual-import.constants";
import {
  listManualImportHandlers,
  resolveManualImportHandler,
} from "./manual-import.resolver";
import manualImportRunService, {
  ManualImportRunService,
} from "./manual-import-run.service";
import {
  MANUAL_IMPORT_ENTITIES,
  ManualImportConfirmRequest,
  ManualImportEntity,
  ManualImportExternalSearchBy,
  ManualImportHandler,
  ManualImportItemResult,
  ManualImportOptionsResponse,
  ManualImportQueues,
  ManualImportResponse,
  ManualImportSavedItem,
  ManualImportSearchBy,
  ManualImportSearchRequest,
  ManualImportSearchResult,
  ManualImportStatusResponse,
  ManualImportWarning,
} from "./manual-import.types";

// Fluxo do import manual: busca → escolha → andamento. Lock/claims ficam no ManualImportRunService.
export class ManualImportService {
  constructor(private readonly runService: ManualImportRunService = manualImportRunService) {}

  // 0 resultado → NOT_FOUND; 1+ → guarda no cache e devolve a lista (CHOOSE) pro confirm.
  async search(
    request: ManualImportSearchRequest,
    requester: Requester,
    queues: ManualImportQueues,
  ): Promise<ManualImportResponse> {
    const { integrationId, entity } = request;
    const handler = await this.resolveHandler(integrationId);
    this.assertSearchSupported(handler, entity, request.by);
    await this.runService.assertNoRunningImport(requester, queues);

    const { by, value } =
      request.by === "local_id"
        ? await this.resolveLocalSearch(handler, entity, request.value)
        : { by: request.by, value: request.value };

    const { items, truncated } = await handler.search(entity, by, value);
    if (!items.length) {
      return { httpStatus: 200, body: { outcome: "NOT_FOUND" } };
    }

    // existsLocally, claims de outras pessoas e aviso de outro import, em paralelo.
    const externalIds = items.map((item) => item.externalId);
    const [localIds, processing, otherImportsRunning] = await Promise.all([
      handler.findLocalIds(entity, externalIds),
      this.runService.findProcessingClaims(integrationId, entity, externalIds, queues),
      this.runService.hasOtherManualImportsRunning(handler, queues),
    ]);
    const warnings = this.buildWarnings(otherImportsRunning);
    const savedItems: ManualImportSavedItem[] = items.map((item) => ({
      externalId: item.externalId,
      label: item.label,
      importable: item.importable,
      ...(item.reason ? { reason: item.reason } : {}),
      existsLocally: localIds.has(item.externalId),
      localId: localIds.get(item.externalId) ?? null,
      enqueueData: item.enqueueData,
    }));

    // Sempre devolve a lista, mesmo com 1 resultado: o usuário confere o dado antes de importar.
    await this.saveSearchResults(requester, integrationId, entity, savedItems);

    const results: ManualImportSearchResult[] = items.map((item, index) => ({
      externalId: item.externalId,
      label: item.label,
      details: item.details,
      importable: item.importable,
      ...(item.reason ? { reason: item.reason } : {}),
      existsLocally: savedItems[index].existsLocally,
      localId: savedItems[index].localId,
      alreadyProcessing: processing.get(item.externalId) ?? null,
    }));

    return {
      httpStatus: 200,
      body: { outcome: "CHOOSE", results, truncated, warnings },
    };
  }

  // Enfileira só o que a busca deste usuário guardou; cada item volta com seu resultado.
  async confirm(
    request: ManualImportConfirmRequest,
    requester: Requester,
    queues: ManualImportQueues,
  ): Promise<ManualImportResponse> {
    const { integrationId, entity, externalIds } = request;

    if (externalIds.length > MANUAL_IMPORT_MAX_ITEMS) {
      throw new ManualImportError(400, {
        code: "MAX_ITEMS_EXCEEDED",
        message: `Máximo de ${MANUAL_IMPORT_MAX_ITEMS} itens por importação`,
        max: MANUAL_IMPORT_MAX_ITEMS,
      });
    }

    const handler = await this.resolveHandler(integrationId);
    if (!handler.supportedSearches[entity]) {
      throw this.unsupportedSearchError(handler, entity);
    }
    await this.runService.assertNoRunningImport(requester, queues);

    const [savedById, otherImportsRunning] = await Promise.all([
      this.loadSearchResults(requester, integrationId, entity, externalIds),
      this.runService.hasOtherManualImportsRunning(handler, queues),
    ]);
    const available = externalIds.flatMap((externalId) => {
      const saved = savedById.get(externalId);
      return saved ? [saved] : [];
    });

    const { run, items: started } = available.length
      ? await this.runService.start({
          requester,
          integrationId,
          entity,
          handler,
          items: available,
          queues,
        })
      : { run: null, items: [] as ManualImportItemResult[] };

    // Mantém a ordem pedida pelo front; o que não estava no cache volta SEARCH_EXPIRED.
    const startedById = new Map(started.map((item) => [item.externalId, item]));
    const items: ManualImportItemResult[] = externalIds.map(
      (externalId) =>
        startedById.get(externalId) ?? {
          externalId,
          label: null,
          status: "SEARCH_EXPIRED",
          reason: "Busca expirada ou inexistente — busque novamente",
          warnings: [],
        },
    );
    const warnings = this.buildWarnings(otherImportsRunning);

    return run
      ? { httpStatus: 202, body: { run, items, warnings } }
      : { httpStatus: 200, body: { items, warnings } };
  }

  // Integrações com import manual, entidades aceitas e tipos de busca — montado do supportedSearches de cada handler.
  async getOptions(): Promise<ManualImportOptionsResponse> {
    const handlers = await listManualImportHandlers();

    return {
      maxItems: MANUAL_IMPORT_MAX_ITEMS,
      integrations: handlers.map(({ handler, integrationId, integrationName }) => ({
        integrationId,
        name: integrationName,
        // Ordem fixa de MANUAL_IMPORT_ENTITIES; local_id entra onde o handler sabe refazer a busca.
        entities: MANUAL_IMPORT_ENTITIES.flatMap((entity) => {
          const searchBy = handler.supportedSearches[entity];
          if (!searchBy) return [];
          const options: ManualImportSearchBy[] = handler.localIdSearchBy[entity]
            ? [...searchBy, "local_id"]
            : [...searchBy];
          return [
            {
              entity,
              label: MANUAL_IMPORT_ENTITY_LABELS[entity],
              searchBy: options.map((by) => ({
                by,
                label: MANUAL_IMPORT_SEARCH_BY_LABELS[by],
              })),
            },
          ];
        }),
      })),
    };
  }

  // Andamento do usuário + flag de outro import manual pendente por integração.
  async getStatus(
    requester: Requester,
    queues: ManualImportQueues,
  ): Promise<ManualImportStatusResponse> {
    const [run, handlers] = await Promise.all([
      this.runService.getLastRunView(requester, queues),
      listManualImportHandlers(),
    ]);
    const othersRunning = await Promise.all(
      handlers.map(async ({ handler, integrationId }) => [
        integrationId,
        await this.runService.hasOtherManualImportsRunning(handler, queues),
      ]),
    );

    return {
      run,
      othersRunning: Object.fromEntries(othersRunning),
      maxItems: MANUAL_IMPORT_MAX_ITEMS,
    };
  }

  // Integração sem handler → 400.
  private async resolveHandler(integrationId: string): Promise<ManualImportHandler> {
    const handler = await resolveManualImportHandler(integrationId);
    if (!handler) {
      throw new ManualImportError(400, {
        code: "INTEGRATION_NOT_SUPPORTED",
        message: "Integração sem suporte a importação manual",
      });
    }
    return handler;
  }

  // `by` fora do supportedSearches do handler → 400; local_id vale onde houver localIdSearchBy.
  private assertSearchSupported(
    handler: ManualImportHandler,
    entity: ManualImportEntity,
    by: ManualImportSearchBy,
  ): void {
    const supported = handler.supportedSearches[entity];
    const isSupported =
      !!supported &&
      (by === "local_id" ? !!handler.localIdSearchBy[entity] : supported.includes(by));
    if (!isSupported) throw this.unsupportedSearchError(handler, entity, by);
  }

  // Erro 400 já com as buscas aceitas pra entidade, pro front exibir.
  private unsupportedSearchError(
    handler: ManualImportHandler,
    entity: ManualImportEntity,
    by?: ManualImportSearchBy,
  ): ManualImportError {
    const supported = handler.supportedSearches[entity];
    return new ManualImportError(400, {
      code: "UNSUPPORTED_SEARCH",
      message: by
        ? `Busca de ${entity} por ${by} não suportada nesta integração`
        : `Importação de ${entity} não suportada nesta integração`,
      supported: supported ? [...supported, "local_id"] : [],
    });
  }

  // local_id → id externo do registro e o tipo de busca equivalente; sem vínculo → 422.
  private async resolveLocalSearch(
    handler: ManualImportHandler,
    entity: ManualImportEntity,
    localId: string,
  ): Promise<{ by: ManualImportExternalSearchBy; value: string }> {
    const externalId = await handler.findExternalIdByLocalId(entity, localId);
    if (!externalId) {
      throw new ManualImportError(422, {
        code: "LOCAL_RECORD_NOT_LINKED",
        message:
          "Registro não encontrado no sistema ou não vinculado a esta integração",
      });
    }
    return { by: handler.localIdSearchBy[entity]!, value: externalId };
  }

  // Avisos de nível do import (os de item vêm em item.warnings).
  private buildWarnings(otherImportsRunning: boolean): ManualImportWarning[] {
    return otherImportsRunning
      ? [MANUAL_IMPORT_WARNINGS.OTHER_MANUAL_IMPORTS_RUNNING]
      : [];
  }

  // Um registro por resultado, numa ida ao Redis (pipeline), com TTL de 30 min.
  private async saveSearchResults(
    requester: Requester,
    integrationId: string,
    entity: ManualImportEntity,
    items: ManualImportSavedItem[],
  ): Promise<void> {
    const pipeline = redisService.client.pipeline();
    for (const item of items) {
      pipeline.set(
        manualImportKeys.search(requester.id, integrationId, entity, item.externalId),
        JSON.stringify(item),
        "EX",
        MANUAL_IMPORT_SEARCH_TTL_S,
      );
    }
    await pipeline.exec();
  }

  // Lê os itens escolhidos do cache numa chamada (MGET); ausente = busca expirada ou de outro usuário.
  private async loadSearchResults(
    requester: Requester,
    integrationId: string,
    entity: ManualImportEntity,
    externalIds: string[],
  ): Promise<Map<string, ManualImportSavedItem>> {
    const raws = await redisService.client.mget(
      ...externalIds.map((externalId) =>
        manualImportKeys.search(requester.id, integrationId, entity, externalId),
      ),
    );
    const saved = new Map<string, ManualImportSavedItem>();
    raws.forEach((raw, index) => {
      if (raw) saved.set(externalIds[index], JSON.parse(raw));
    });
    return saved;
  }
}

export default new ManualImportService();
