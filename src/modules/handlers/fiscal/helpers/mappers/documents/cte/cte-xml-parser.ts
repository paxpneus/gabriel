// integrations/sieg/services/documents/ctes/cte-xml-parser.ts
import { XMLParser } from "fast-xml-parser";
import { CteTakerType } from "../../../../../../warehouse/fiscal/ctes/cte/cte.types";

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

export interface CteXmlExtracted {
  chave: string | null;
  number: number | null;
  series: number | null;
  totalValue: number;
  issueDate: Date | null;
  operationDate: Date | null;

  issuerTaxId: string | null;
  senderTaxId: string | null;
  recipientTaxId: string | null;
  dispatcherTaxId: string | null;
  receiverTaxId: string | null;

  issuerName: string | null;
  senderName: string | null;
  recipientName: string | null;
  dispatcherName: string | null;
  receiverName: string | null;

  issuerCity: string | null;
  issuerUf: string | null;
  senderCity: string | null;
  senderUf: string | null;
  recipientCity: string | null;
  recipientUf: string | null;
  dispatcherCity: string | null;
  dispatcherUf: string | null;
  receiverCity: string | null;
  receiverUf: string | null;

  takerType: CteTakerType | null;
  takerTaxId: string | null;
}

const parseNum = (val: any): number => {
  if (val === null || val === undefined) return 0;
  const parsed = parseFloat(String(val).replace(",", "."));
  return isNaN(parsed) ? 0 : parsed;
};

const cleanDocument = (doc: any): string | null => {
  if (!doc) return null;
  const cleaned = String(doc).replace(/\D/g, "");
  return cleaned.length ? cleaned : null;
};

/** Extrai { city, uf } de um bloco de endereço genérico (enderEmit/enderReme/enderExped/enderDest/enderReceb) */
const extractAddress = (enderBlock: any): { city: string | null; uf: string | null } => ({
  city: enderBlock?.xMun ?? null,
  uf: enderBlock?.UF ?? null,
});

export function extractCteFromXml(xmlContent: string): CteXmlExtracted {
  const parsed = xmlParser.parse(xmlContent);

  const cteProc = parsed?.cteProc;
  const infCte = cteProc?.CTe?.infCte ?? parsed?.CTe?.infCte;
  const infProt = cteProc?.protCTe?.infProt;

  if (!infCte) {
    throw new Error("[CTE_XML_PARSER] infCte não encontrado no XML.");
  }

  const ide = infCte.ide ?? {};
  const emit = infCte.emit ?? {};
  const rem = infCte.rem ?? {};
  const exped = infCte.exped ?? {};
  const receb = infCte.receb ?? {}; 
  const dest = infCte.dest ?? {};
  const vPrest = infCte.vPrest ?? {};

  const chave =
    infProt?.chCTe ??
    (typeof infCte["@_Id"] === "string" ? infCte["@_Id"].replace(/^CTe/i, "") : null);

  const issuerTaxId = cleanDocument(emit.CNPJ);
  const senderTaxId = cleanDocument(rem.CNPJ ?? rem.CPF);
  const recipientTaxId = cleanDocument(dest.CNPJ ?? dest.CPF);
  const dispatcherTaxId = cleanDocument(exped.CNPJ ?? exped.CPF);
  const receiverTaxId = cleanDocument(receb.CNPJ ?? receb.CPF);

  // ─── Endereços ────────────────────────────────────────────────────────
  const issuerAddr = extractAddress(emit.enderEmit);
  const senderAddr = extractAddress(rem.enderReme);
  const recipientAddr = extractAddress(dest.enderDest);
  const dispatcherAddr = extractAddress(exped.enderExped);
  const receiverAddr = extractAddress(receb.enderReceb);

  // ─── Tomador do serviço (quem paga o frete) ────────────────────────────
  let takerType: CteTakerType | null = null;
  let takerTaxId: string | null = null;

  if (ide.toma4) {
    takerType = "THIRD_PARTY";
    takerTaxId = cleanDocument(ide.toma4.CNPJ ?? ide.toma4.CPF);
  } else if (ide.toma3?.toma !== undefined) {
    switch (String(ide.toma3.toma)) {
      case "0": // Remetente
        takerType = "ISSUER";
        takerTaxId = senderTaxId;
        break;
      case "1": // Expedidor
        takerType = "DISPATCHER";
        takerTaxId = dispatcherTaxId;
        break;
      case "2": // Recebedor
        takerType = "RECEIVER";
        takerTaxId = receiverTaxId;
        break;
      case "3": // Destinatário
        takerType = "ADDRESSEE";
        takerTaxId = recipientTaxId;
        break;
      default:
        console.warn(`[CTE_XML_PARSER] toma3.toma desconhecido: ${ide.toma3.toma}`);
    }
  }

  return {
    chave,
    number: ide.nCT ? parseInt(String(ide.nCT), 10) : null,
    series: ide.serie ? parseInt(String(ide.serie), 10) : null,
    totalValue: parseNum(vPrest.vTPrest ?? vPrest.vRec),
    issueDate: ide.dhEmi ? new Date(ide.dhEmi) : null,
    operationDate: infProt?.dhRecbto
      ? new Date(infProt.dhRecbto)
      : ide.dhEmi
        ? new Date(ide.dhEmi)
        : null,

    issuerTaxId,
    senderTaxId,
    recipientTaxId,
    dispatcherTaxId,
    receiverTaxId,

    issuerName: emit.xNome ?? null,
    senderName: rem.xNome ?? null,
    recipientName: dest.xNome ?? null,
    dispatcherName: exped.xNome ?? null,
    receiverName: receb.xNome ?? null,

    issuerCity: issuerAddr.city,
    issuerUf: issuerAddr.uf,
    senderCity: senderAddr.city,
    senderUf: senderAddr.uf,
    recipientCity: recipientAddr.city,
    recipientUf: recipientAddr.uf,
    dispatcherCity: dispatcherAddr.city,
    dispatcherUf: dispatcherAddr.uf,
    receiverCity: receiverAddr.city,
    receiverUf: receiverAddr.uf,

    takerType,
    takerTaxId,
  };
}