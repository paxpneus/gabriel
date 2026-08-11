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
import unitBusinessService from "../../../../../company/unit-business/unit-business.service";
import { getDateRangeAsDate } from "../../../../../../shared/utils/normalizers/date";

const DELAY_BETWEEN_REQUESTS_MS = 10 * 1000;
const PROVIDER_NAME = "Sieg";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Papéis que uma loja pode assumir num CT-e. "emit" fica de fora por padrão
// (loja nunca é transportadora), mas deixamos parametrizável caso algum
// CNPJ de loja também opere como transportadora.
type CteRole = "dest" | "rem" | "tom" | "emit";

const ROLES_TO_QUERY: CteRole[] = ["tom"];

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

    const unitBusinesses = await unitBusinessService.getComercialUnitBusinessOnly();

    if (!unitBusinesses.length) {
      console.warn(
        "[CteIngestionQueue] Nenhuma UnitBusiness PHYSICAL encontrada.",
      );
      return;
    }

    const handler = resolveDocumentHandler(PROVIDER_NAME);
    const { inicio: dataEmissaoInicio, fim: dataEmissaoFim } = getDateRangeAsDate(1);

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
        const params = buildParamsForRole(role, unit.cnpj, dataEmissaoInicio, dataEmissaoFim);

        await this.fetchAndProcess(
          handler,
          params,
          `loja=${unit.name} | ${role}=${unit.cnpj}`,
        );

        const isLastRole = r === ROLES_TO_QUERY.length - 1;
        const isLastUnit = i === unitBusinesses.length - 1;
        if (!isLastRole || !isLastUnit) {
          await sleep(DELAY_BETWEEN_REQUESTS_MS);
        }
      }
    }

    console.log(
      `[CteIngestionQueue] Busca periódica de CTes finalizada. jobId=${job.id}`,
    );
  }

  private async fetchAndProcess(
    handler: DocumentSearchHandler,
    genericParams: GenericXmlDocumentParams,
    logLabel: string,
  ): Promise<void> {
    try {
      const providerParams = handler.mapParams(genericParams);
      const response = await handler.fetchXmlDocuments(providerParams);
      const documents = handler.mapXmlDocuments(response);

      console.log(
        `[CteIngestionQueue] ${logLabel} -> ${documents.length} documento(s) recebido(s).`,
      );

      for (const doc of documents) {
        try {
          await fetchAndUpsertCte(doc);
        } catch (err: any) {
          console.warn(
            `[CteIngestionQueue] Falha ao upsertar CTe | ${logLabel} | erro=${err?.message}`,
          );
        }
      }
    } catch (err: any) {
      console.warn(
        `[CteIngestionQueue] Falha ao buscar documentos | ${logLabel} | erro=${err?.message}`,
      );
    }
  }
}