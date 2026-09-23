jest.mock("pdf-parse", () => jest.fn());
jest.mock("../../../providers/ai/gemini-vision.service", () => ({
  __esModule: true,
  default: {
    extractFromText: jest.fn(),
    extractFromInlineData: jest.fn(),
  },
}));

import pdfParse from "pdf-parse";
import geminiVisionService from "../../../providers/ai/gemini-vision.service";
import { extractStructuredDataFromDocument } from "../document-extraction";

describe("extractStructuredDataFromDocument", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("PDF nativo com texto suficiente: usa o texto local, nunca manda o binário pro Gemini", async () => {
    (pdfParse as unknown as jest.Mock).mockResolvedValue({
      text: "texto nativo bem longo ".repeat(5),
    });
    (geminiVisionService.extractFromText as jest.Mock).mockResolvedValue(
      "resultado",
    );

    const result = await extractStructuredDataFromDocument({
      buffer: Buffer.from(""),
      mimeType: "application/pdf",
      prompt: "prompt",
    });

    expect(result).toBe("resultado");
    expect(geminiVisionService.extractFromText).toHaveBeenCalledWith({
      text: expect.stringContaining("texto nativo"),
      prompt: "prompt",
    });
    expect(geminiVisionService.extractFromInlineData).not.toHaveBeenCalled();
  });

  it("PDF sem texto suficiente (escaneado): cai pro binário via Gemini", async () => {
    (pdfParse as unknown as jest.Mock).mockResolvedValue({ text: "" });
    (
      geminiVisionService.extractFromInlineData as jest.Mock
    ).mockResolvedValue("resultado-imagem");

    const result = await extractStructuredDataFromDocument({
      buffer: Buffer.from(""),
      mimeType: "application/pdf",
      prompt: "prompt",
    });

    expect(result).toBe("resultado-imagem");
    expect(geminiVisionService.extractFromText).not.toHaveBeenCalled();
  });

  it("pdf-parse lançando erro: também cai pro binário via Gemini", async () => {
    (pdfParse as unknown as jest.Mock).mockRejectedValue(new Error("boom"));
    (
      geminiVisionService.extractFromInlineData as jest.Mock
    ).mockResolvedValue("resultado-imagem");

    const result = await extractStructuredDataFromDocument({
      buffer: Buffer.from(""),
      mimeType: "application/pdf",
      prompt: "prompt",
    });

    expect(result).toBe("resultado-imagem");
  });

  it("imagem (não PDF): vai direto pro Gemini binário, sem tentar pdf-parse", async () => {
    (
      geminiVisionService.extractFromInlineData as jest.Mock
    ).mockResolvedValue("resultado-imagem");

    const result = await extractStructuredDataFromDocument({
      buffer: Buffer.from(""),
      mimeType: "image/png",
      prompt: "prompt",
    });

    expect(result).toBe("resultado-imagem");
    expect(pdfParse).not.toHaveBeenCalled();
  });
});
