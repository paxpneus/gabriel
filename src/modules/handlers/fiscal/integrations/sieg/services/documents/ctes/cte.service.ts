// integrations/sieg/services/documents/xml-documents.service.ts
import axios from "axios";
import { siegApi } from "../../../api/sieg_api.service";
import { unzipBuffer } from "../../../../../../../../shared/utils/normalizers/zip";
import {
  DocumentSearchHandler,
  GenericXmlDocumentParams,
  XmlDocumentResult,
} from "../../../../../helpers/mappers/documents/map-fiscal-documents.types";
import {
  SiegBaixarXmlsRequest,
  SiegBaixarXmlsResponse,
  SiegTipoXml,
} from "./cte.types";
import { getSiegIntegration } from "../../../api/sieg_api.service";
import integrationLoggerService from "../../../../../../../integrations/integration-errors/integration-logger.service";
import { IntegrationErrorEntity } from "../../../../../../../integrations/integration-errors/integration-error.types";

// Limite documentado da Sieg pra /v1/baixar-xmls: 2 requisições/minuto, até 50 XMLs por requisição.
// Hard limits (não vêm de env — são o próprio contrato da Sieg, nunca ultrapassar mesmo com env mal configurada).
const SIEG_BAIXAR_XMLS_MAX_PAGE_SIZE = 50;
const SIEG_BAIXAR_XMLS_MIN_INTERVAL_MS = 30_000; // 60s / 2 req

const SIEG_XML_PAGE_SIZE = Math.min(
  Number(process.env.SIEG_XML_PAGE_SIZE ?? 50),
  SIEG_BAIXAR_XMLS_MAX_PAGE_SIZE,
);

const SIEG_XML_REQUEST_TIMEOUT_MS = Number(
  process.env.SIEG_XML_REQUEST_TIMEOUT_MS ?? 60_000,
);

const SIEG_MIN_INTERVAL_MS = Math.max(
  Number(process.env.SIEG_MIN_INTERVAL_MS ?? 35_000),
  SIEG_BAIXAR_XMLS_MIN_INTERVAL_MS,
);

// Retry específico para falha no meio da paginação: em vez de descartar
// tudo que já foi baixado, tenta a MESMA página de novo depois de um tempo.
const SIEG_PAGE_RETRY_DELAY_MS = Number(
  process.env.SIEG_PAGE_RETRY_DELAY_MS ?? 35_000,
);
const SIEG_PAGE_MAX_RETRIES = Number(
  process.env.SIEG_PAGE_MAX_RETRIES ?? 5,
);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let siegNextAvailableAt = 0;
let siegThrottleChain: Promise<void> = Promise.resolve();

const throttleSiegRequest = (): Promise<void> => {
  const scheduled = siegThrottleChain.then(async () => {
    const waitMs = Math.max(0, siegNextAvailableAt - Date.now());
    if (waitMs > 0) await sleep(waitMs);
    siegNextAvailableAt = Date.now() + SIEG_MIN_INTERVAL_MS;
  });
  siegThrottleChain = scheduled;
  return scheduled;
};


const mapParams = (
  params: GenericXmlDocumentParams,
): SiegBaixarXmlsRequest => ({
  TipoXml: SiegTipoXml.CTE,
  Take: params.take ?? 0,
  Skip: params.skip ?? 0,
  DataEmissaoInicio: params.dataEmissaoInicio.toISOString(),
  DataEmissaoFim: params.dataEmissaoFim.toISOString(),
  CNPJemit: params.cnpjEmit,
  CNPJdest: params.cnpjDest,
  CNPJrem: params.cnpjRem,
  CNPJtom: params.cnpjTom,
});

const fetchXmlPage = async (
  params: SiegBaixarXmlsRequest,
): Promise<string[] | "no-results"> => {
  await throttleSiegRequest();

  // Nunca deixa passar do máximo de 50 XMLs/requisição da Sieg, mesmo se
  // um chamador passar um Take explícito maior.
  const boundedParams: SiegBaixarXmlsRequest =
    params.Take && params.Take > SIEG_BAIXAR_XMLS_MAX_PAGE_SIZE
      ? { ...params, Take: SIEG_BAIXAR_XMLS_MAX_PAGE_SIZE }
      : params;

  try {
    const { data } = await siegApi.post<ArrayBuffer | unknown[]>(
      "/v1/baixar-xmls",
      boundedParams,
      {
        responseType: "arraybuffer",
        timeout: SIEG_XML_REQUEST_TIMEOUT_MS,
      },
    );

    if (Array.isArray(data)) {
      return "no-results";
    }

    const zipBuffer = Buffer.from(data as ArrayBuffer);
    return unzipBuffer(zipBuffer, { extension: "xml" }).map(
      (entry) => entry.content,
    );
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.data) {
      const rawBody = error.response.data;
      const bodyText =
        rawBody instanceof ArrayBuffer || Buffer.isBuffer(rawBody)
          ? Buffer.from(rawBody as ArrayBuffer).toString("utf-8")
          : JSON.stringify(rawBody);

      console.error(
        `[SiegApi] /v1/baixar-xmls falhou (${error.response.status}):`,
        bodyText,
      );

      throw new Error(
        `[SiegApi] /v1/baixar-xmls falhou (${error.response.status}): ${bodyText}`,
      );
    }

    throw error;
  }
};

// Tenta buscar uma página; se falhar, tenta de novo a MESMA página
// (mesmo Skip) depois de SIEG_PAGE_RETRY_DELAY_MS, até SIEG_PAGE_MAX_RETRIES vezes.
const fetchXmlPageWithRetry = async (
  params: SiegBaixarXmlsRequest,
  attempt = 1,
): Promise<string[] | "no-results"> => {
  try {
    return await fetchXmlPage(params);
  } catch (error: any) {
    if (attempt > SIEG_PAGE_MAX_RETRIES) {
      throw error;
    }

    console.warn(
      `[SiegApi] Falha na página (Skip=${params.Skip}). ` +
      `Retry ${attempt}/${SIEG_PAGE_MAX_RETRIES} em ${SIEG_PAGE_RETRY_DELAY_MS / 1000}s. ` +
      `erro=${error?.message}`,
    );

    const integration = await getSiegIntegration();
    await integrationLoggerService.log({
      entity: IntegrationErrorEntity.CTE,
      type: "SIEG_PAGE_RETRY",
      integrationsId: integration.id,
      reference: `Skip=${params.Skip}`,
      message: error?.message ?? "Falha na página, tentando novamente",
      // ainda tentando — só vira falha real se esgotar SIEG_PAGE_MAX_RETRIES
      // (ver o outro catch, mais acima em fetchXmlPage/fetchAndProcess).
      createIntegrationError: false,
    });

    await sleep(SIEG_PAGE_RETRY_DELAY_MS);
    return fetchXmlPageWithRetry(params, attempt + 1);
  }
};

const fetchXmlDocuments = async (
  params: SiegBaixarXmlsRequest,
): Promise<SiegBaixarXmlsResponse> => {
  console.log("[Sieg Request Params]", params);

  const wantsAllPages = !params.Take || params.Take === 0;

  if (!wantsAllPages) {
    const page = await fetchXmlPageWithRetry(params);
    const xmlContents = page === "no-results" ? [] : page;
    console.log("[Sieg Response] total de xmls recebidos:", xmlContents.length);
    return xmlContents;
  }

  let skip = params.Skip ?? 0;
  let allXmlContents: string[] = [];
  let page_log = 0

  while (true) {
    const pageParams: SiegBaixarXmlsRequest = {
      ...params,
      Take: SIEG_XML_PAGE_SIZE,
      Skip: skip,
    };
    page_log++

    const page = await fetchXmlPageWithRetry(pageParams);

    if (page === "no-results") break;

    allXmlContents = allXmlContents.concat(page);

    if (page.length < SIEG_XML_PAGE_SIZE) break;

    skip += SIEG_XML_PAGE_SIZE;

    console.log("Pagina", page_log, "Retornou: " + page.length, "Total: " + allXmlContents.length)
  }

  console.log(
    "[Sieg Response] total de xmls recebidos:",
    allXmlContents.length,
  );

  return allXmlContents;
};

const mapXmlDocuments = (
  response: SiegBaixarXmlsResponse,
): XmlDocumentResult[] => {
  if (!response?.length) return [];

  return response.map((xmlContent) => ({
    xmlBase64: Buffer.from(xmlContent, "utf-8").toString("base64"),
  }));
};

export const siegDocumentHandler: DocumentSearchHandler<
  SiegBaixarXmlsRequest,
  SiegBaixarXmlsResponse
> = {
  api: siegApi,
  mapParams,
  fetchXmlDocuments,
  mapXmlDocuments,
};