import { gerarPDF } from "@alexssmusica/node-pdf-nfe";
import { PassThrough } from "stream";

// Extraído de invoice.controller.ts::getDanfeBatch — único lugar que gerava
// DANFE a partir de XML antes deste helper existir. Usado pela Tecinco (que
// só manda XML, nunca um PDF pronto); a Bling manda o DANFE pronto
// (linkPDF), não passa por aqui.
export async function generateDanfePdfBuffer(xmlContent: string): Promise<Buffer> {
  const doc = await gerarPDF(xmlContent, { cancelada: false });

  return new Promise<Buffer>((resolve, reject) => {
    const pass = new PassThrough();
    const chunks: Buffer[] = [];
    pass.on("data", (chunk: Buffer) => chunks.push(chunk));
    pass.on("end", () => resolve(Buffer.concat(chunks)));
    pass.on("error", reject);
    doc.pipe(pass);
  });
}
