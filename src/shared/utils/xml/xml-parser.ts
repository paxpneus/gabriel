import { XMLParser } from "fast-xml-parser"

const parser = new XMLParser({
  ignoreAttributes: false,
})

export default parser

export function extractChaveFromXml(xml: string): string {
  if (!xml) return ''

  const parsed = parser.parse(xml)

  const infNFe =
    parsed?.nfeProc?.NFe?.infNFe ||
    parsed?.procNFe?.NFe?.infNFe ||
    parsed?.NFe?.infNFe

  const rawId: string = infNFe?.['@_Id'] ?? infNFe?.$?.Id ?? ''
  return rawId.replace(/^NFe/, '').replace(/\D/g, '')
}