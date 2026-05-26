// src/modules/sefaz/sefaz_api/sefaz_api.service.ts

import https from "https";
import { XMLParser } from "fast-xml-parser";
import zlib from "zlib";
import { CertificateService } from "../services/sefaz.service";
import {
  SefazConsultaParams,
  SefazDistribuicaoResponse,
  SefazDocumento,
  SefazEnvironment,
} from "./sefaz_api.types";

const ENDPOINTS: Record<SefazEnvironment, string> = {
  producao:
    "https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
  homologacao:
    "https://hom.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx",
};

const SOAP_ACTION =
  "http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse";

const xmlParser = new XMLParser({ ignoreAttributes: false });

// Stats válidos: 137 = sem docs, 138 = docs encontrados
const VALID_CSTATS = ["137", "138"];

export class SefazApiService {
  private agent: https.Agent;
  private environment: SefazEnvironment;

  constructor() {
    this.environment =
      process.env.SEFAZ_ENV === "homologacao" ? "homologacao" : "producao";

    const { pfxBuffer, passphrase } = CertificateService.loadPfx();

    this.agent = new https.Agent({
      pfx: pfxBuffer,
      passphrase,
      rejectUnauthorized: true,
    });
  }

  private buildEnvelope(params: SefazConsultaParams): string {
    const tpAmb = this.environment === "producao" ? "1" : "2";
    const ultNSU = params.ultNSU.padStart(15, "0");

    return `<?xml version="1.0" encoding="utf-8"?>
<soap12:Envelope
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:xsd="http://www.w3.org/2001/XMLSchema"
  xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">
  <soap12:Body>
    <nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe">
      <nfeDadosMsg>
        <distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01">
          <tpAmb>${tpAmb}</tpAmb>
          <cUFAutor>${params.cUF}</cUFAutor>
          <CNPJ>${params.cnpj}</CNPJ>
          <distNSU>
            <ultNSU>${ultNSU}</ultNSU>
          </distNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
  }

  private async postSoap(envelope: string): Promise<string> {
    const url = new URL(ENDPOINTS[this.environment]);
    const body = Buffer.from(envelope, "utf-8");

    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: url.hostname,
          path: url.pathname,
          method: "POST",
          agent: this.agent,
          headers: {
            "Content-Type": "application/soap+xml; charset=utf-8",
            "Content-Length": body.length,
            SOAPAction: SOAP_ACTION,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => chunks.push(chunk));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf-8");
            if (res.statusCode !== 200) {
              reject(
                new Error(
                  `[Sefaz] HTTP ${res.statusCode}: ${raw.slice(0, 300)}`,
                ),
              );
            } else {
              resolve(raw);
            }
          });
        },
      );

      req.on("error", (err) =>
        reject(new Error(`[Sefaz] Erro de rede: ${err.message}`)),
      );
      req.write(body);
      req.end();
    });
  }

  private parseResponse(xml: string): SefazDistribuicaoResponse {
    const parsed = xmlParser.parse(xml);

    const retDistDFeInt =
      parsed?.["soap:Envelope"]?.["soap:Body"]
        ?.["nfeDistDFeInteresseResponse"]
        ?.["nfeDistDFeInteresseResult"]
        ?.["retDistDFeInt"];

    if (!retDistDFeInt)
      throw new Error("[Sefaz] Estrutura de resposta inesperada");

    const cStat = String(retDistDFeInt.cStat);
    const xMotivo = String(retDistDFeInt.xMotivo ?? "");

    if (!VALID_CSTATS.includes(cStat)) {
      throw new Error(`[Sefaz] cStat=${cStat} xMotivo=${xMotivo}`);
    }

    const docZip = retDistDFeInt?.loteDistDFeInt?.docZip;
    const documentosRaw = docZip
      ? Array.isArray(docZip)
        ? docZip
        : [docZip]
      : [];

    const documentos: SefazDocumento[] = documentosRaw.map((doc: Record<string, string>) => ({
      NSU: String(doc["@_NSU"]).padStart(15, "0"),
      schema: doc["@_schema"],
      xmlBase64: doc["#text"],
    }));

    return {
      cStat,
      xMotivo,
      ultNSU: String(retDistDFeInt.ultNSU).padStart(15, "0"),
      maxNSU: String(retDistDFeInt.maxNSU).padStart(15, "0"),
      documentos,
    };
  }

  async consultarDistribuicao(
    params: SefazConsultaParams,
  ): Promise<SefazDistribuicaoResponse> {
    const envelope = this.buildEnvelope(params);
    const xml = await this.postSoap(envelope);
    return this.parseResponse(xml);
  }

  // XMLs da SEFAZ vêm como base64(gzip(xml))
  decodeDocumento(base64Gzip: string): string {
    const buffer = Buffer.from(base64Gzip, "base64");
    return zlib.gunzipSync(buffer).toString("utf-8");
  }
}

export const sefazApiService = new SefazApiService();