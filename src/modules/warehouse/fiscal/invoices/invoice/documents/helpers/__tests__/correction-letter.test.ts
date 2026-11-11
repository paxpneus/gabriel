import { parseCorrectionLetterText } from "../correction-letter";

describe("parseCorrectionLetterText", () => {
  it("lê chave de acesso em blocos de 4 e o número da NF-e (sem ponto de milhar)", () => {
    const text = [
      "CARTA DE CORREÇÃO ELETRÔNICA",
      "Chave de acesso",
      "3126 1002 3167 4900 2111 5500 2000 0223 0717 2738 2457",
      "NF-e Nº 022.307 Série 2",
      "Protocolo 131260000000000",
    ].join("\n");

    expect(parseCorrectionLetterText(text)).toEqual({
      isCorrectionLetter: true,
      accessKey: "31261002316749002111550020000223071727382457",
      number: "022307",
    });
  });

  it("PDF da Bling (sem título, cabeçalho \"Nº Correção Data\") é carta de correção", () => {
    const text = [
      "NF-e Nº 022307 Série 2",
      "PAX COMERCIO DE PNEUS LTDA",
      "Chave de acesso",
      "31261102316749002111550020000223071944979199",
      "Número de protocolo",
      "131268053286543",
      "Data emissão",
      "03/11/2026",
      "Nº Correção Data",
      "1",
      "ONDE SE LE TRANSPORTADORA , CORRETO TRANSPORTADORA RODONAVES ,",
    ].join("\n");

    expect(parseCorrectionLetterText(text)).toEqual({
      isCorrectionLetter: true,
      accessKey: "31261102316749002111550020000223071944979199",
      number: "022307",
    });
  });

  it("acentos decompostos (NFD) e colunas coladas no texto extraído", () => {
    const text = "NºCorrec\u0327a\u0303oData\n31261102316749002111550020000223071944979199\nNF-e Nº 022307";
    expect(parseCorrectionLetterText(text).isCorrectionLetter).toBe(true);
  });

  it("chave em 44 dígitos seguidos e N° com grau", () => {
    const text = "Carta de Correcao\n31261002316749002111550020000223071727382457\nNF-e N° 022307";
    expect(parseCorrectionLetterText(text)).toMatchObject({
      accessKey: "31261002316749002111550020000223071727382457",
      number: "022307",
    });
  });

  it("PDF que não é carta de correção nem tem chave → tudo vazio", () => {
    expect(parseCorrectionLetterText("DANFE\nDOCUMENTO AUXILIAR")).toEqual({
      isCorrectionLetter: false,
      accessKey: null,
      number: null,
    });
  });
});
