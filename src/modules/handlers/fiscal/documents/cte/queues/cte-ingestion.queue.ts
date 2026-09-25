// modules/handlers/fiscal-documents/services/ctes/cte-ingestion.queue.ts
import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { resolveDocumentHandler } from "../../../helpers/mappers/documents/map-fiscal-documents.service";
import {
  XmlDocumentType,
  GenericXmlDocumentParams,
  DocumentSearchHandler,
} from "../../../helpers/mappers/documents/map-fiscal-documents.types";
import { fetchAndUpsertCte } from "../../../helpers/mappers/documents/cte/cte-upsert.service";
import { extractCteFromXml } from "../../../helpers/mappers/documents/cte/cte-xml-parser";
import Cte from "../../../../../warehouse/fiscal/ctes/cte/cte.model";
import cteService from "../../../../../warehouse/fiscal/ctes/cte/services/cte.service";
import unitBusinessService from "../../../../../company/unit-business/unit-business.service";
import { getIncrementalDateRangeAsDate } from "../../../../../../shared/utils/normalizers/date";
import syncDatafreteCteService, {
  isDatafreteFreightTakerNumber,
} from "../../../../logistic/services/sync-datafrete-cte.service";
import { XmlDocumentResult } from "../../../helpers/mappers/documents/map-fiscal-documents.types";
import { getSiegIntegration } from "../../../../fiscal/integrations/sieg/api/sieg_api.service";
import { getDatafreteIntegration } from "../../../../logistic/transporters/data-frete/api/data-frete_api.service";
import {
  describeDatafreteCodigoRetorno,
  extractDatafreteCodigoRetorno,
  extractDatafreteMensagem,
} from "../../../../logistic/transporters/data-frete/helpers/error-codes";
import { buildCteDatafreteErrorLogFields } from "../../../../logistic/transporters/data-frete/helpers/cte-error-log.helper";
import integrationLoggerService from "../../../../../integrations/integration-errors/integration-logger.service";
import { IntegrationErrorEntity } from "../../../../../integrations/integration-errors/integration-error.types";

const DELAY_BETWEEN_REQUESTS_MS = 30 * 1000;
const PROVIDER_NAME = "Sieg";

const BACKFILL_CHUNK_MAX_DAYS = 55;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type CteRole = "dest" | "rem" | "tom" | "emit";
const ROLES_TO_QUERY: CteRole[] = ["tom"];

interface DateRange {
  inicio: Date;
  fim: Date;
}

const buildParamsForRole = (
  role: CteRole,
  cnpj: string,
  dataEmissaoInicio: Date,
  dataEmissaoFim: Date,
): GenericXmlDocumentParams => {
  const base: GenericXmlDocumentParams = {
    documentType: XmlDocumentType.CTE,
    dataEmissaoInicio,
    dataEmissaoFim,
  };

  switch (role) {
    case "dest":
      return { ...base, cnpjDest: cnpj };
    case "rem":
      return { ...base, cnpjRem: cnpj };
    case "tom":
      return { ...base, cnpjTom: cnpj };
    case "emit":
      return { ...base, cnpjEmit: cnpj };
  }
};

function splitDateRangeInChunks(
  start: Date,
  end: Date,
  maxDays: number = BACKFILL_CHUNK_MAX_DAYS,
): DateRange[] {
  const ranges: DateRange[] = [];
  const maxMs = maxDays * 24 * 60 * 60 * 1000;

  let chunkStart = new Date(start);

  while (chunkStart < end) {
    const candidate = new Date(chunkStart.getTime() + maxMs);
    const chunkEnd = candidate > end ? end : candidate;

    ranges.push({ inicio: chunkStart, fim: chunkEnd });
    chunkStart = chunkEnd;
  }

  return ranges;
}

export class CteIngestionQueue extends BaseQueueService<void> {
  constructor(options: { workless?: boolean } = {}) {
    super("CTE_INGESTION", {
      concurrency: 1,
      lockDuration: 60 * 60 * 1000,
      workless: options.workless,
    });
  }

  async process(job: Job<void, void, string>): Promise<void> {
    console.log(
      `[CteIngestionQueue] Iniciando busca periódica de CTes. jobId=${job.id}`,
    );

    const { inicio, fim } = getIncrementalDateRangeAsDate(2);

    const dateRanges = splitDateRangeInChunks(inicio, fim);

    console.log(
      `[CteIngestionQueue] Intervalo incremental dividido em ${dateRanges.length} bloco(s).`,
    );

    await this.runForDateRanges(dateRanges, `${job.id}`);
  }

  async runBackfill(
    startDate: Date,
    endDate: Date = new Date(),
  ): Promise<void> {
    const dateRanges = splitDateRangeInChunks(startDate, endDate);

    console.log(
      `[CteIngestionQueue][BACKFILL] ${dateRanges.length} bloco(s) de até ${BACKFILL_CHUNK_MAX_DAYS} dias ` +
        `(${startDate.toISOString()} -> ${endDate.toISOString()}).`,
    );

    await this.runForDateRanges(dateRanges, "backfill");
  }

  private async runForDateRanges(
    dateRanges: DateRange[],
    jobId: string,
  ): Promise<void> {
    const unitBusinesses =
      await unitBusinessService.getComercialUnitBusinessOnly();

    if (!unitBusinesses.length) {
      console.warn(
        "[CteIngestionQueue] Nenhuma UnitBusiness PHYSICAL encontrada.",
      );
      return;
    }

    const handler = resolveDocumentHandler(PROVIDER_NAME);

    for (let rangeIdx = 0; rangeIdx < dateRanges.length; rangeIdx++) {
      const { inicio: dataEmissaoInicio, fim: dataEmissaoFim } =
        dateRanges[rangeIdx];

      console.log(
        `[CteIngestionQueue] Bloco ${rangeIdx + 1}/${dateRanges.length}: ${dataEmissaoInicio.toISOString()} -> ${dataEmissaoFim.toISOString()}`,
      );

      for (let i = 0; i < unitBusinesses.length; i++) {
        const unit = unitBusinesses[i];

        if (!unit.cnpj) {
          console.warn(
            `[CteIngestionQueue] UnitBusiness ${unit.id} (${unit.name}) sem CNPJ. Pulando.`,
          );
          continue;
        }

        console.log(
          `[CteIngestionQueue] (${i + 1}/${unitBusinesses.length}) loja=${unit.name} cnpj=${unit.cnpj}`,
        );

        for (let r = 0; r < ROLES_TO_QUERY.length; r++) {
          const role = ROLES_TO_QUERY[r];
          const params = buildParamsForRole(
            role,
            unit.cnpj,
            dataEmissaoInicio,
            dataEmissaoFim,
          );

          await this.fetchAndProcess(
            handler,
            params,
            `bloco=${rangeIdx + 1}/${dateRanges.length} | loja=${unit.name} | ${role}=${unit.cnpj}`,
            isDatafreteFreightTakerNumber(unit.number),
          );

          const isLastRole = r === ROLES_TO_QUERY.length - 1;
          const isLastUnit = i === unitBusinesses.length - 1;
          const isLastRange = rangeIdx === dateRanges.length - 1;
          if (!isLastRole || !isLastUnit || !isLastRange) {
            await sleep(DELAY_BETWEEN_REQUESTS_MS);
          }
        }
      }
    }

    console.log(`[CteIngestionQueue] Busca finalizada. jobId=${jobId}`);

    await this.syncPendingCtesWithDatafrete();
  }

  private async syncPendingCtesWithDatafrete(): Promise<void> {
    console.log(
      "[CteIngestionQueue] Sincronizando CT-es pendentes com a Datafrete...",
    );

    try {
      const result = await syncDatafreteCteService.syncPendingCtes();

      console.log(
        `[CteIngestionQueue] Sincronização Datafrete concluída: ` +
          `processados=${result.ctesProcessed}, já importados=${result.alreadyImported}, falhas=${result.failed}`,
      );
    } catch (err: any) {
      console.warn(
        `[CteIngestionQueue] Falha ao sincronizar CT-es com a Datafrete: ${err?.message}`,
      );
    }
  }

  private async syncCteWithDatafrete(cte: Cte, logLabel: string): Promise<void> {
    try {
      const wasAlreadyImported = await syncDatafreteCteService.syncCte(cte);

      console.log(
        `[CteIngestionQueue] Datafrete | ${logLabel} | chave=${cte.xml_key} ` +
          `${wasAlreadyImported ? "já existia na Datafrete" : "importado"}, synched=true.`,
      );
    } catch (err: any) {
      console.warn(
        `[CteIngestionQueue] Falha ao sincronizar CT-e com a Datafrete | ${logLabel} | chave=${cte.xml_key} | erro=${err?.message}`,
      );

      const codigoRetorno = extractDatafreteCodigoRetorno(err);
      const integration = await getDatafreteIntegration();
      const { internalId, externalId, reference } = buildCteDatafreteErrorLogFields(err, cte);
      await integrationLoggerService.log({
        entity: IntegrationErrorEntity.CTE,
        type: codigoRetorno?.toString() ?? "UNKNOWN",
        integrationsId: integration.id,
        internalId,
        externalId,
        reference,
        message:
          extractDatafreteMensagem(err) ??
          (codigoRetorno
            ? describeDatafreteCodigoRetorno(codigoRetorno)
            : (err?.message ?? "Erro desconhecido ao sincronizar CT-e com a Datafrete")),
        createIntegrationError: true,
      });
    }
  }

  // Evita gastar o pipeline completo (parse pesado, resolve de transportador,
  // encrypt, upload) em documentos que a Sieg já mandou antes — só a chave é
  // extraída aqui, o parse completo continua dentro de fetchAndUpsertCte.
  private async filterNewDocuments(
    documents: XmlDocumentResult[],
  ): Promise<XmlDocumentResult[]> {
    const chavesByDoc = documents.map((doc) => ({
      doc,
      chave: extractCteFromXml(
        Buffer.from(doc.xmlBase64, "base64").toString("utf-8"),
      ).chave,
    }));

    const chaves = chavesByDoc
      .map(({ chave }) => chave)
      .filter((chave): chave is string => !!chave);

    const existingChaves = await cteService.findExistingXmlKeys(chaves);

    return chavesByDoc
      .filter(({ chave }) => !chave || !existingChaves.has(chave))
      .map(({ doc }) => doc);
  }

  private async fetchAndProcess(
    handler: DocumentSearchHandler,
    genericParams: GenericXmlDocumentParams,
    logLabel: string,
    isFreightTaker: boolean,
  ): Promise<void> {
    try {
      const providerParams = handler.mapParams(genericParams);
      const response = await handler.fetchXmlDocuments(providerParams);
      const documents = handler.mapXmlDocuments(response);

      const newDocuments = await this.filterNewDocuments(documents);

      console.log(
        `[CteIngestionQueue] ${logLabel} -> ${documents.length} documento(s) recebido(s), ` +
          `${newDocuments.length} novo(s) (${documents.length - newDocuments.length} já no sistema, pulado).`,
      );

      for (const doc of newDocuments) {
        try {
          const cte = await fetchAndUpsertCte(doc);

          if (cte && !cte.synched && isFreightTaker) {
            await this.syncCteWithDatafrete(cte, logLabel);
          }
        } catch (err: any) {
          console.warn(
            `[CteIngestionQueue] Falha ao upsertar CTe | ${logLabel} | erro=${err?.message}`,
          );

          const integration = await getSiegIntegration();
          await integrationLoggerService.log({
            entity: IntegrationErrorEntity.CTE,
            type: "CTE_UPSERT_FAILED",
            integrationsId: integration.id,
            reference: logLabel,
            message: err?.message ?? "Erro desconhecido ao upsertar CT-e",
            createIntegrationError: true,
          });
        }
      }
    } catch (err: any) {
      console.warn(
        `[CteIngestionQueue] Falha ao buscar documentos | ${logLabel} | erro=${err?.message}`,
      );

      const integration = await getSiegIntegration();
      await integrationLoggerService.log({
        entity: IntegrationErrorEntity.CTE,
        type: "SIEG_FETCH_FAILED",
        integrationsId: integration.id,
        reference: logLabel,
        message: err?.message ?? "Erro desconhecido ao buscar documentos na Sieg",
        createIntegrationError: true,
      });
    }
  }
}
