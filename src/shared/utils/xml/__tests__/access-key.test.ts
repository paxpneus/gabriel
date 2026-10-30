import { extractReceiverCnpjFromXmlContent } from "../access-key";

describe("extractReceiverCnpjFromXmlContent", () => {
  it("CNPJ do <dest>, nunca o do <emit> nem o do transportador", () => {
    const xml =
      "<infNFe><emit><CNPJ>02316749002383</CNPJ></emit><dest><CNPJ>02316749001220</CNPJ><xNome>LOJA 12</xNome></dest>" +
      "<transp><transporta><CNPJ>11222333000181</CNPJ></transporta></transp></infNFe>";
    expect(extractReceiverCnpjFromXmlContent(xml)).toBe("02316749001220");
  });

  it.each([
    ["destinatário pessoa física (CPF)", "<dest><CPF>12345678909</CPF></dest>"],
    ["sem <dest>", "<emit><CNPJ>02316749002383</CNPJ></emit>"],
  ])("%s → null", (_case, xml) => {
    expect(extractReceiverCnpjFromXmlContent(xml)).toBeNull();
  });
});
