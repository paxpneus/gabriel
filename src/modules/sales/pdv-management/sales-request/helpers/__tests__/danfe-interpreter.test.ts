jest.mock("pdf-parse", () => jest.fn());

import pdfParse from "pdf-parse";
import { extractDanfeIdentification } from "../danfe-interpreter";

const ACCESS_KEY = "35250114200014665500123456789012345678901234";
const EMITTER_CNPJ = "02316749002383";

describe("extractDanfeIdentification", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("PDF nativo com chave, número e CNPJ do emitente no texto: resolve via regex local", async () => {
    (pdfParse as unknown as jest.Mock).mockResolvedValue({
      text: `IDENTIFICAÇÃO DO EMITENTE\nCNPJ 02.316.749/0023-83\nNF-e Nº. 020.309 SÉRIE 1\nCHAVE DE ACESSO ${ACCESS_KEY}`,
    });

    const result = await extractDanfeIdentification(
      Buffer.from(""),
      "application/pdf",
    );

    expect(result).toEqual({
      accessKey: ACCESS_KEY,
      number: "020309",
      emitterCnpj: EMITTER_CNPJ,
      receiverCnpj: null,
    });
  });

  it("não confunde o CNPJ do emitente com o CNPJ/CPF do destinatário", async () => {
    (pdfParse as unknown as jest.Mock).mockResolvedValue({
      text: `IDENTIFICAÇÃO DO EMITENTE\nCNPJ 02.316.749/0023-83\nNF-e Nº. 020.309 SÉRIE 1\nCHAVE DE ACESSO ${ACCESS_KEY}\nDESTINATÁRIO/REMETENTE\nCNPJ/CPF 11.222.333/0001-81`,
    });

    const result = await extractDanfeIdentification(
      Buffer.from(""),
      "application/pdf",
    );

    expect(result.emitterCnpj).toBe(EMITTER_CNPJ);
    expect(result.receiverCnpj).toBe("11222333000181");
  });

  it("PDF nativo com chave e número mas SEM CNPJ do emitente legível: resolve chave+número via regex, emitterCnpj fica null", async () => {
    (pdfParse as unknown as jest.Mock).mockResolvedValue({
      text: `NF-e Nº. 020.309 SÉRIE 1\nCHAVE DE ACESSO ${ACCESS_KEY}`,
    });

    const result = await extractDanfeIdentification(
      Buffer.from(""),
      "application/pdf",
    );

    expect(result).toEqual({
      accessKey: ACCESS_KEY,
      number: "020309",
      emitterCnpj: null,
      receiverCnpj: null,
    });
  });

  // Regressão real: DANFE gerado pela Tecinco/Sefaz tem layout POSICIONAL —
  // o número da nota é extraído ANTES do rótulo "Nº"/"SÉRIE" (o valor grande
  // fica impresso acima da legenda pequena no PDF), e o rótulo "CNPJ" fica
  // longe do valor de verdade (cabeçalhos de coluna se concatenam sem
  // espaço). Texto real capturado via log de diagnóstico em produção —
  // nunca simplificar de volta pro formato "rótulo: valor" nos dois campos.
  it("DANFE real (layout posicional Tecinco/Sefaz): número vem antes de 'Nº'/'SÉRIE', CNPJ do emitente longe do rótulo 'CNPJ'", async () => {
    const REAL_TEXT =
      "\n\n920\n1\nNF-e\nNº\nSÉRIE\nDATA DO RECEBIMENTO\nRECEBI(EMOS) DE INDAIATUBA, A(s) MERCADORIA(S) CONSTANTES DA NF-e INDICADA AO LADO:\nIDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR\nPAX COMERCIO DE PNEUS LTDA\nAV VISCONDE DE INDAIATUBA 727\nINDAIATUBA SP\nVILA VITORIA I\n13338-010\nAtendimento: (18) 3325-1204\nCHAVE DE ACESSO\n3526 0902 3167 4900 2383 5500 1000 0009 2014 6628 5878\nNATUREZA DA OPERAÇÃOPROTOCÓLO DE AUTORIZAÇÃO\nINSCRIÇÃO ESTADUAL\nCNPJINSCRIÇÃO ESTADUAL SUBST. TRIBUTÁRIO\nDANFE\nDocumento Auxiliar da\nNota Fiscal Eletrônica\n0 - ENTRADA\n1 - SAÍDA\n920\n1\nNº\nSÉRIE\nFOLHA\n1\nSAIDA PECAS TRANSFERENCIA\n35369837011302.316.749/0023-83\n1/1\nConsulta  de  autenticidade  no  portal  nacional  da  NF-e\nwww.nfe.fazenda.gov.br/portal ou no site da Sefaz\nAutorizadora\n135264045958345\nDESTINATÁRIO/REMETENTE\nNOME / RAZÃO SOCIALCNPJ/CPFDATA DE EMISSÃO\nPAX COMERCIO DE PNEUS EIRELI - LOJA 12\nDATA DE ENTRADA/SAÍDAENDEREÇO\nAV. DURVALINO BINATO, 400 ********\nBAIRRO\nJARDIM AEROPORTO\nCEP\n19813-170\n26/09/2026 10:27:34\n26/09/2026";
    (pdfParse as unknown as jest.Mock).mockResolvedValue({ text: REAL_TEXT });

    const result = await extractDanfeIdentification(
      Buffer.from(""),
      "application/pdf",
    );

    expect(result).toEqual({
      accessKey: "35260902316749002383550010000009201466285878",
      number: "920",
      emitterCnpj: "02316749002383",
      // Texto capturado termina antes do CNPJ do destinatário.
      receiverCnpj: null,
    });
  });

  // Regressão real (NF 997, transferência CD SP → Loja 12): o canhoto traz "DESTINATÁRIO:" ANTES do emitente — o destinatário
  // vem do cabeçalho "DESTINATÁRIO / REMETENTE", nunca do canhoto, e para antes do transportador.
  it("DANFE real com canhoto: emitente e destinatário pela seção certa", async () => {
    (pdfParse as unknown as jest.Mock).mockResolvedValue({
      text: "\n\nRECEBEMOS  DE  PAX  COMERCIO  DE  PNEUS  LTDA  OS  PRODUTOS  E/OU  SERVIÇOS  CONSTANTES  DA  NOTA  FISCAL  ELETRÔNICA  INDICADA  \nABAIXO. EMISSÃO: 07/10/2026 17:23:20 - VALOR TOTAL: 2.310,05 - DESTINATÁRIO: PAX COMERCIO DE PNEUS EIRELI - LOJA 12 - ENDEREÇO: AV. \nDURVALINO BINATO\nDATA DE RECEBIMENTOIDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR\nNF-e\nNº. 000.000.997\nSérie 1\nDANFE\nIDENTIFICAÇÃO DO EMITENTE\nPAX COMERCIO DE PNEUS LTDA\nAV VISCONDE DE INDAIATUBA, 727 \nVILA VITORIA I. INDAIATUBA-SP\nCEP: 13338-010\nTelefone: (18) 3325-1204\nDocumento Auxiliar da \nNota Fiscal Eletrônica\n0 - ENTRADA\n1 - SAÍDA\n1\nConsulta de autenticidade no portal nacional da NF-e\nwww.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora\nNº. 000.000.997\nSérie 1\nCHAVE DE ACESSO\n3526 1002 3167 4900 2383 5500 1000 0009 9714 2305 5876\nPROTOCOLO DE AUTORIZAÇÃO DE USO\n135 264 241 909 685 - 07/10/2026 17:23:12\nNATUREZA DA OPERAÇÃO\nSAIDA PECAS TRANSFERENCIA\nINSCRIÇÃO ESTADUAL\n35.369.837.011-3\nINSCRIÇÃO ESTADUAL DO SUBST. TRIBUT.CNPJ\n02.316.749/0023-83\nDESTINATÁRIO / REMETENTE\nNOME / RAZÃO SOCIAL\nPAX COMERCIO DE PNEUS EIRELI - LOJA 12\nCNPJ / CPF\n02.316.749/0012-20\nDATA DA EMISSÃO\n07/10/2026\nENDEREÇO\nAV. DURVALINO BINATO, 400 ********\nBAIRRO / DISTRITO\nJARDIM AEROPORTO\nCEP\n19813-170\nDATA DA SAÍDA\n07/10/2026\nMUNICÍPIO\nASSIS\nUF\nSP\nFONE / FAX\n(18) 3325-1204\nINSCRIÇÃO ESTADUAL\n18.925.575.011-0\nHORA DA SAÍDA\n17:23:20\nCÁLCULO DO IMPOSTO\nBASE DE CÁLCULO DO ICMS\n0,00\nVALOR DO ICMS\n0,00\nBASE DE CÁLC. ICMS S.T.\n0,00\nVALOR DO ICMS SUBST.\n0,00\nVALOR IMP. IMPORTAÇÃO\n0,00\nVALOR DO PIS\n0,00\nVALOR TOTAL DOS PRODUTOS\n2.310,05\nVALOR DO FRETE\n0,00\nVALOR DO SEGURO\n0,00\nDESCONTO\n0,00\nOUTRAS DESPESAS\n0,00\nVALOR TOTAL DO IPI\n0,00\nVALOR DA COFINS\n0,00\nVALOR TOTAL DA NOTA\n2.310,05\nTRANSPORTADOR / VOLUMES TRANSPORTADOS\nNOME / RAZÃO SOCIALFRETE POR CONTA\n9 - Sem Ocorr de Transp\nCÓDIGO ANTTPLACA DO VEÍCULOUFCNPJ / CPF\nENDEREÇOMUNICÍPIOUFINSCRIÇÃO ESTADUAL\nQUANTIDADE\n4\nESPÉCIEMARCANUMERAÇÃOPESO BRUTOPESO LÍQUIDO\n",
    });

    const result = await extractDanfeIdentification(Buffer.from(""), "application/pdf");

    expect(result.accessKey).toBe("35261002316749002383550010000009971423055876");
    expect(result.emitterCnpj).toBe("02316749002383");
    expect(result.receiverCnpj).toBe("02316749001220");
  });

  it("destinatário sem CNPJ formatado na seção (CPF) → null, sem pegar o CNPJ do transportador", async () => {
    (pdfParse as unknown as jest.Mock).mockResolvedValue({
      text: `CNPJ 02.316.749/0023-83\nDESTINATÁRIO / REMETENTE\nCNPJ / CPF\n123.456.789-09\nTRANSPORTADOR / VOLUMES TRANSPORTADOS\nCNPJ 11.222.333/0001-81`,
    });

    const result = await extractDanfeIdentification(Buffer.from(""), "application/pdf");

    expect(result.receiverCnpj).toBeNull();
  });

  it("número com separador deslocado pelo OCR (0.20309): limpa pra 020309", async () => {
    (pdfParse as unknown as jest.Mock).mockResolvedValue({
      text: `Nº 0.20309 SÉRIE 1\nCHAVE DE ACESSO ${ACCESS_KEY}`,
    });

    const result = await extractDanfeIdentification(
      Buffer.from(""),
      "application/pdf",
    );

    expect(result.number).toBe("020309");
  });

  // Sem fallback de IA (decisão explícita — ver comentário em
  // danfe-interpreter.ts): PDF sem texto nativo legível ou foto/escaneado
  // simplesmente não resolve nada, quem chama pede o XML da nota.
  it("PDF sem chave/número/CNPJ no texto nativo: devolve os três null, sem tentar nada além da regex", async () => {
    (pdfParse as unknown as jest.Mock).mockResolvedValue({
      text: "sem nada legível aqui",
    });

    const result = await extractDanfeIdentification(
      Buffer.from(""),
      "application/pdf",
    );

    expect(result).toEqual({ accessKey: null, number: null, emitterCnpj: null, receiverCnpj: null });
  });

  it("foto (image/*): não tenta nem ler texto nativo, devolve os três null direto", async () => {
    const result = await extractDanfeIdentification(
      Buffer.from(""),
      "image/jpeg",
    );

    expect(result).toEqual({ accessKey: null, number: null, emitterCnpj: null, receiverCnpj: null });
    expect(pdfParse).not.toHaveBeenCalled();
  });

  it("pdf-parse lança (PDF corrompido/ilegível): devolve os três null em vez de propagar", async () => {
    (pdfParse as unknown as jest.Mock).mockRejectedValue(new Error("boom"));

    const result = await extractDanfeIdentification(
      Buffer.from(""),
      "application/pdf",
    );

    expect(result).toEqual({ accessKey: null, number: null, emitterCnpj: null, receiverCnpj: null });
  });
});
