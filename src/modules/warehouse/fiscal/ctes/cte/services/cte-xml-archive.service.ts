import { decryptXml, isEncrypted } from "../../../../../../shared/utils/xml/xml-cipher";
import uploaderService from "../../../../../handlers/uploader/services/uploader.service";
import cteService, { CteService } from "./cte.service";

const buildXmlFileName = (number: number, id: string) => `${number}_${id}.xml`;

function requireXmlDirectory(): string {
  const directory = process.env.CTE_XML_DIRECTORY;
  if (!directory) throw new Error("CTE_XML_DIRECTORY não configurado");
  return directory;
}

export class CteXmlArchiveService {
  constructor(private cteSvc: CteService = cteService) {}

  // Uma listagem do diretório em vez de um HEAD por CT-e: marca em lote o que já está
  // na nuvem e devolve só os ids que realmente precisam de upload.
  async reconcilePending(): Promise<string[]> {
    const pending = await this.cteSvc.findPendingCloudArchive();
    if (!pending.length) return [];

    const directory = requireXmlDirectory();
    const existingNames = await uploaderService.listFileNames(directory);

    const alreadyArchivedIds: string[] = [];
    const missingIds: string[] = [];
    for (const { id, number } of pending) {
      (existingNames.has(buildXmlFileName(number, id)) ? alreadyArchivedIds : missingIds).push(id);
    }

    if (alreadyArchivedIds.length) {
      await this.cteSvc.markCloudArchived(
        alreadyArchivedIds,
        uploaderService.normalizeDirectory(directory),
      );
    }

    return missingIds;
  }

  // Idempotente: o banco (cloud_path) é o ponteiro durável — qualquer falha
  // aqui deixa cloud_path null e o sweep do UploaderQueue reenfileira.
  async archive(cteId: string): Promise<void> {
    const cte = await this.cteSvc.findById(cteId, {
      attributes: ["id", "number", "xml_path", "cloud_path"],
    });

    if (!cte || cte.cloud_path) return;
    if (!cte.xml_path) throw new Error(`CT-e ${cteId} sem XML para arquivar`);

    // Legado: xml_path era a URL do arquivo já hospedado.
    if (cte.xml_path.startsWith("http")) {
      await this.cteSvc.update(cte.id, { cloud_path: cte.xml_path });
      return;
    }

    const directory = requireXmlDirectory();

    const xml = isEncrypted(cte.xml_path) ? decryptXml(cte.xml_path) : cte.xml_path;

    const cloudPath = await uploaderService.uploadIfMissing({
      buffer: Buffer.from(xml, "utf-8"),
      filename: buildXmlFileName(cte.number, cte.id),
      mimeType: "application/xml",
      directory,
      preserveFilename: true,
    });

    await this.cteSvc.update(cte.id, { cloud_path: cloudPath });
  }
}

export default new CteXmlArchiveService();
