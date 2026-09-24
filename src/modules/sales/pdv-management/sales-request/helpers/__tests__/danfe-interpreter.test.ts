jest.mock("pdf-parse", () => jest.fn());
jest.mock(
  "../../../../../../shared/utils/documents/document-extraction",
  () => ({
    __esModule: true,
    extractStructuredDataFromDocument: jest.fn(),
  }),
);

import pdfParse from "pdf-parse";
import { extractStructuredDataFromDocument } from "../../../../../../shared/utils/documents/document-extraction";
import { extractAccessKeyFromDanfe } from "../danfe-interpreter";

const ACCESS_KEY = "35250114200014665500123456789012345678901234";

describe("extractAccessKeyFromDanfe", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("PDF nativo com chave no texto: resolve via regex local, sem chamar IA", async () => {
    (pdfParse as unknown as jest.Mock).mockResolvedValue({
      text: `CHAVE DE ACESSO ${ACCESS_KEY}`,
    });

    const result = await extractAccessKeyFromDanfe(
      Buffer.from(""),
      "application/pdf",
    );

    expect(result).toBe(ACCESS_KEY);
    expect(extractStructuredDataFromDocument).not.toHaveBeenCalled();
  });

  it("PDF sem chave no texto nativo: cai pro fallback via IA", async () => {
    (pdfParse as unknown as jest.Mock).mockResolvedValue({
      text: "sem chave nenhuma aqui",
    });
    (extractStructuredDataFromDocument as jest.Mock).mockResolvedValue(
      ACCESS_KEY,
    );

    const result = await extractAccessKeyFromDanfe(
      Buffer.from(""),
      "application/pdf",
    );

    expect(result).toBe(ACCESS_KEY);
    expect(extractStructuredDataFromDocument).toHaveBeenCalled();
  });

  it("foto (image/*): vai direto pro fallback via IA", async () => {
    (extractStructuredDataFromDocument as jest.Mock).mockResolvedValue(
      ACCESS_KEY,
    );

    const result = await extractAccessKeyFromDanfe(
      Buffer.from(""),
      "image/jpeg",
    );

    expect(result).toBe(ACCESS_KEY);
    expect(pdfParse).not.toHaveBeenCalled();
  });

  it("IA não consegue ler: retorna null", async () => {
    (extractStructuredDataFromDocument as jest.Mock).mockResolvedValue(
      "null",
    );

    const result = await extractAccessKeyFromDanfe(
      Buffer.from(""),
      "image/jpeg",
    );

    expect(result).toBeNull();
  });

  it("IA falha (erro/timeout): retorna null em vez de propagar", async () => {
    (extractStructuredDataFromDocument as jest.Mock).mockRejectedValue(
      new Error("boom"),
    );

    const result = await extractAccessKeyFromDanfe(
      Buffer.from(""),
      "image/jpeg",
    );

    expect(result).toBeNull();
  });
});
