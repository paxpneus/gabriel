// sefaz_api.service.ts

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

// FIX A: removeNSPrefix garante que tanto "soap:" quanto "soap12:" sejam lidos
// sem quebrar o parsing independente do prefixo retornado pela SEFAZ.
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  removeNSPrefix: true,
});

// FIX C: VALID_CSTATS usado apenas no fluxo de distNSU / consNSU.
// O consultarPorChave tem seu próprio conjunto de cStats aceitáveis.
const VALID_CSTATS = ["137", "138"];

// cStats aceitáveis na consulta por chave de acesso (consChNFe):
//   138 = documento localizado (procNFe disponível)
//   137 = nenhum documento (nota ainda não disponível — sem rejeição, apenas ausente)
//   140 = lote de distribuição gerado (também válido em alguns cenários)
// Rejeição 632 (não autorizado) não está aqui intencionalmente — é tratada
// como ausência de XML, não como erro fatal do serviço.
const VALID_CSTATS_CHAVE = ["137", "138", "140"];

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

  private buildEnvelopeDistNSU(params: SefazConsultaParams): string {
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

  private buildEnvelopeConsNSU(params: { cnpj: string; cUF: string; NSU: string }): string {
    const tpAmb = this.environment === "producao" ? "1" : "2";

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
          <consNSU>
            <NSU>${params.NSU.padStart(15, "0")}</NSU>
          </consNSU>
        </distDFeInt>
      </nfeDadosMsg>
    </nfeDistDFeInteresse>
  </soap12:Body>
</soap12:Envelope>`;
  }

  private buildEnvelopeConsChNFe(params: { cnpj: string; cUF: string; chNFe: string }): string {
    const tpAmb = this.environment === "producao" ? "1" : "2";

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
          <consChNFe>
            <chNFe>${params.chNFe}</chNFe>
          </consChNFe>
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
              reject(new Error(`[Sefaz] HTTP ${res.statusCode}: ${raw.slice(0, 300)}`));
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

  // FIX A: Com removeNSPrefix: true no parser, o acesso ao objeto não precisa
  // mais de prefixo — "Envelope", "Body" etc. funcionam independente de
  // "soap:" ou "soap12:" ter sido usado na resposta da SEFAZ.
  private extractRetDistDFeInt(parsed: any): any {
    const retDistDFeInt =
      parsed?.["Envelope"]?.["Body"]
        ?.["nfeDistDFeInteresseResponse"]
        ?.["nfeDistDFeInteresseResult"]
        ?.["retDistDFeInt"];

    if (!retDistDFeInt)
      throw new Error("[Sefaz] Estrutura de resposta inesperada");

    return retDistDFeInt;
  }

  private parseResponse(xml: string, validCStats = VALID_CSTATS): SefazDistribuicaoResponse {
    const parsed = xmlParser.parse(xml);
    const retDistDFeInt = this.extractRetDistDFeInt(parsed);

    const cStat = String(retDistDFeInt.cStat);
    const xMotivo = String(retDistDFeInt.xMotivo ?? "");

    if (!validCStats.includes(cStat)) {
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

  async consultarDistribuicao(params: SefazConsultaParams): Promise<SefazDistribuicaoResponse> {
    const envelope = this.buildEnvelopeDistNSU(params);
    const xml = await this.postSoap(envelope);
    return this.parseResponse(xml);
  }

  // FIX C: consultarPorChave usa VALID_CSTATS_CHAVE em vez do conjunto global.
  // Retorna null quando a SEFAZ confirma que o documento não está disponível
  // (cStat=137 sem procNFe), evitando lançar erro genérico nesses casos.
  // O chamador deve tratar null como "nota não disponível ainda — aguardar manifestação".
  async consultarPorChave(chNFe: string, cnpj: string): Promise<string | null> {
    const cUF = chNFe.substring(0, 2);
    const envelope = this.buildEnvelopeConsChNFe({ cnpj, cUF, chNFe });
    const xml = await this.postSoap(envelope);

    // FIX C: usa conjunto de cStats específico para consChNFe
    const response = this.parseResponse(xml, VALID_CSTATS_CHAVE);

    const procNFe = response.documentos.find((d) => d.schema.startsWith("procNFe"));
    if (!procNFe) {
      // cStat=137 ou documento não liberado (aguarda manifestação) — não é um erro
      console.log(
        `[Sefaz] consultarPorChave chave=${chNFe} cStat=${response.cStat} — procNFe não disponível (${response.xMotivo})`,
      );
      return null;
    }

    return this.decodeDocumento(procNFe.xmlBase64);
  }

  async descobrirMaxNSU(cnpj: string, cUF: string): Promise<string> {
    const envelope = this.buildEnvelopeConsNSU({ cnpj, cUF, NSU: "000000000000001" });
    const xml = await this.postSoap(envelope);
    const parsed = xmlParser.parse(xml);

    // FIX A: removeNSPrefix: true — sem prefixo no acesso
    const retDistDFeInt =
      parsed?.["Envelope"]?.["Body"]
        ?.["nfeDistDFeInteresseResponse"]
        ?.["nfeDistDFeInteresseResult"]
        ?.["retDistDFeInt"];

    if (!retDistDFeInt) throw new Error("[Sefaz] Estrutura inesperada em consNSU");

    return String(retDistDFeInt.maxNSU).padStart(15, "0");
  }

  decodeDocumento(base64Gzip: string): string {
    const buffer = Buffer.from(base64Gzip, "base64");
    return zlib.gunzipSync(buffer).toString("utf-8");
  }
}

export const sefazApiService = new SefazApiService();