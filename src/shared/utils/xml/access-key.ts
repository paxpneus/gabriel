// Extrai a chave de acesso (44 dígitos) de um XML de NF-e via regex simples,
// sem depender do parser completo de invoice-xml.ts — evita import
// circular (invoice-xml.ts chama o PdvSalesRequestService no hook de
// cancelamento, e o PdvSalesRequestService precisa da chave pra localizar a
// invoice recém-upsertada depois de importar um XML de nota de transferência).
export function extractAccessKeyFromXmlContent(xmlContent: string): string | null {
  const idMatch = xmlContent.match(/Id="NFe(\d{44})"/);
  if (idMatch) return idMatch[1];

  const chNFeMatch = xmlContent.match(/<chNFe>(\d{44})<\/chNFe>/);
  if (chNFeMatch) return chNFeMatch[1];

  return null;
}
