// cte-xml.service.ts
import { decryptXml, isEncrypted } from "../../../../../../shared/utils/xml/xml-cipher";
import cteRepository, { CteRepository } from "../cte.repository";

export class CteXmlService {
  constructor(private repository: CteRepository = cteRepository) {}

  async *streamXmlEntries(
    ids: string[],
    chunkSize = 100,
  ): AsyncGenerator<{ filename: string; xml: string }> {
    for (let i = 0; i < ids.length; i += chunkSize) {
      const chunkIds = ids.slice(i, i + chunkSize);
      const ctes = await this.repository.findXmlPathsByIds(chunkIds);

      for (const cte of ctes) {
        let xml = cte.xml_path;

        if (!xml || xml.startsWith("http")) {
          console.warn(
            `[XML BATCH] CT-e ${cte.id}: XML não disponível, pulando.`,
          );
          continue;
        }

        try {
          if (isEncrypted(xml)) xml = decryptXml(xml);
          const filename = `cte-${cte.number ?? cte.xml_key}.xml`;
          yield { filename, xml };
        } catch (err: any) {
          console.error(`[XML BATCH] Erro CT-e ${cte.id}:`, err.message);
        }
      }
    }
  }
}

export default new CteXmlService();
