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

const DELAY_BETWEEN_REQUESTS_MS = 30 * 1000;
const PROVIDER_NAME = "Sieg";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

    const unitBusinesses = await unitBusinessService.findAll({
      where: { type: "PHYSICAL" },
    });

    if (!unitBusinesses.length) {
      console.warn(
        "[CteIngestionQueue] Nenhuma UnitBusiness PHYSICAL encontrada.",
      );
      return;
    }

    const handler = resolveDocumentHandler(PROVIDER_NAME);
    const { inicio: dataEmissaoInicio, fim: dataEmissaoFim } = getDateRangeAsDate(5);

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

      // ─── CNPJ como emitente ─────────────────────────────────────────────
      await this.fetchAndProcess(
        handler,
        {
          documentType: XmlDocumentType.CTE,
          dataEmissaoInicio,
          dataEmissaoFim,
          cnpjEmit: unit.cnpj,
        },
        `loja=${unit.name} | emit=${unit.cnpj}`,
      );

      await sleep(DELAY_BETWEEN_REQUESTS_MS);

      // ─── CNPJ como destinatário ─────────────────────────────────────────
      await this.fetchAndProcess(
        handler,
        {
          documentType: XmlDocumentType.CTE,
          dataEmissaoInicio,
          dataEmissaoFim,
          cnpjDest: unit.cnpj,
        },
        `loja=${unit.name} | dest=${unit.cnpj}`,
      );

      const isLastUnit = i === unitBusinesses.length - 1;
      if (!isLastUnit) {
        await sleep(DELAY_BETWEEN_REQUESTS_MS);
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
