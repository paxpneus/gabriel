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

export interface AccessKeyParts {
  emitterCnpj: string;
  model: string;
  series: string;
  number: string;
}

// Layout da chave: cUF(2) AAMM(4) CNPJ(14) mod(2) série(3) nNF(9) tpEmis(1) cNF(8) cDV(1).
export function parseAccessKey(accessKey: string): AccessKeyParts | null {
  if (!/^\d{44}$/.test(accessKey)) return null;
  return {
    emitterCnpj: accessKey.slice(6, 20),
    model: accessKey.slice(20, 22),
    series: String(Number(accessKey.slice(22, 25))),
    number: String(Number(accessKey.slice(25, 34))),
  };
}
