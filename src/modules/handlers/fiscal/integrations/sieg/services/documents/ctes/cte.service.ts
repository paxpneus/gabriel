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

const SIEG_XML_PAGE_SIZE = Number(process.env.SIEG_XML_PAGE_SIZE ?? 50);

const SIEG_XML_REQUEST_TIMEOUT_MS = Number(
  process.env.SIEG_XML_REQUEST_TIMEOUT_MS ?? 60_000,
);

const SIEG_MIN_INTERVAL_MS = Number(process.env.SIEG_MIN_INTERVAL_MS ?? 30_000);

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
  try {
    const { data } = await siegApi.post<ArrayBuffer | unknown[]>(
      "/v1/baixar-xmls",
      params,
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

const fetchXmlDocuments = async (
  params: SiegBaixarXmlsRequest,
): Promise<SiegBaixarXmlsResponse> => {
  console.log("[Sieg Request Params]", params);

  const wantsAllPages = !params.Take || params.Take === 0;

  if (!wantsAllPages) {
    const page = await fetchXmlPage(params);
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

    const page = await fetchXmlPage(pageParams);

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
