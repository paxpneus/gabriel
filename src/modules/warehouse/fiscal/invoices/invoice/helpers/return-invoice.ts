import parser from "../../../../../../shared/utils/xml/xml-parser";
import { decryptXml, isEncrypted } from "../../../../../../shared/utils/xml/xml-cipher";

// finNFe da NF-e (ide.finNFe): 4 = devolução de mercadoria.
const NFE_RETURN_PURPOSE = "4";

export function isReturnInvoicePurpose(finNFe: unknown): boolean {
  return String(finNFe ?? "").trim() === NFE_RETURN_PURPOSE;
}

// Mesma checagem a partir do xml_path gravado (cifrado ou legado em texto puro).
export function isStoredXmlReturnInvoice(xmlPath: string): boolean {
  const xml = isEncrypted(xmlPath) ? decryptXml(xmlPath) : xmlPath;
  const parsed = parser.parse(xml);
  const nfe =
    parsed?.nfeProc?.NFe?.infNFe ||
    parsed?.procNFe?.NFe?.infNFe ||
    parsed?.NFe?.infNFe;
  return isReturnInvoicePurpose(nfe?.ide?.finNFe);
}
