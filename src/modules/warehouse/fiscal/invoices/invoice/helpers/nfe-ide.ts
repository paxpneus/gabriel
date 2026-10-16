import { Sequelize } from "sequelize";
import { decryptXmlHead, isEncrypted } from "../../../../../../shared/utils/xml/xml-cipher";
import { InvoiceDirection } from "./invoice-direction";

// finNFe da NF-e (ide.finNFe): 1 normal, 2 complementar, 3 ajuste, 4 devolução.
export const NFE_RETURN_PURPOSE = 4;

// "<iv hex>:" + 2752 chars base64 (2064 bytes) — o <ide> fica antes de ~600 bytes em quase toda nota.
const XML_HEAD_LENGTH = 33 + 2752;

export interface NfeIde {
  operationType: InvoiceDirection | null;
  purpose: number | null;
}

export function parseNfePurpose(finNFe: unknown): number | null {
  const purpose = Number(String(finNFe ?? "").trim());
  return Number.isInteger(purpose) && purpose >= 1 && purpose <= 4 ? purpose : null;
}

// tpNF: 0 entrada, 1 saída — tipo do documento, do ponto de vista do emitente.
export function parseNfeOperationType(tpNF: unknown): InvoiceDirection | null {
  const value = String(tpNF ?? "").trim();
  if (value === "0") return "INCOMING";
  if (value === "1") return "OUTGOING";
  return null;
}

// Início do xml_path gravado, pra ler o <ide> sem trazer a nota inteira.
export function xmlHeadLiteral(alias = "Invoice") {
  return Sequelize.literal(`LEFT("${alias}"."xml_path", ${XML_HEAD_LENGTH})`);
}

// Aceita o xml_path inteiro ou só o início; null quando o <finNFe> (vem depois do tpNF) não está no trecho.
export function readNfeIde(storedXml: string | null | undefined): NfeIde | null {
  if (!storedXml) return null;
  let xml: string;
  try {
    xml = isEncrypted(storedXml) ? decryptXmlHead(storedXml) : storedXml;
  } catch {
    return null;
  }
  const finNFe = xml.match(/<finNFe>(\d)<\/finNFe>/)?.[1];
  if (finNFe === undefined) return null;
  return {
    operationType: parseNfeOperationType(xml.match(/<tpNF>(\d)<\/tpNF>/)?.[1]),
    purpose: parseNfePurpose(finNFe),
  };
}
