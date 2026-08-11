import AdmZip from "adm-zip";

export interface ZipEntryResult {
  /** Nome do arquivo dentro do zip, incluindo path relativo (ex: "notas/123.xml") */
  name: string;
  /** Conteúdo do arquivo já decodificado como string (utf-8) */
  content: string;
}

export interface UnzipOptions {
  /**
   * Filtra entradas por extensão (ex: "xml", "json"). Case-insensitive.
   * Se omitido, retorna todas as entradas (exceto diretórios).
   */
  extension?: string;
  /** Encoding usado para decodificar o conteúdo de cada entrada. Default: "utf-8". */
  encoding?: BufferEncoding;
}

/**
 * Descompacta um Buffer de zip e retorna o conteúdo de cada entrada como string.
 * Ignora diretórios. Filtra por extensão se `options.extension` for informado.
 */
export function unzipBuffer(
  zipBuffer: Buffer,
  options: UnzipOptions = {},
): ZipEntryResult[] {
  const { extension, encoding = "utf-8" } = options;
  const zip = new AdmZip(zipBuffer);

  return zip
    .getEntries()
    .filter((entry) => {
      if (entry.isDirectory) return false;
      if (!extension) return true;

      const normalizedExt = extension.toLowerCase().replace(/^\./, "");
      return entry.entryName.toLowerCase().endsWith(`.${normalizedExt}`);
    })
    .map((entry) => ({
      name: entry.entryName,
      content: entry.getData().toString(encoding),
    }));
}

/**
 * Mesma coisa que unzipBuffer, mas recebendo o zip como string base64
 * (caso comum de APIs que retornam arquivos binários embutidos em JSON/texto).
 */
export function unzipBase64(
  base64Zip: string,
  options: UnzipOptions = {},
): ZipEntryResult[] {
  const zipBuffer = Buffer.from(base64Zip, "base64");
  return unzipBuffer(zipBuffer, options);
}

/**
 * Atalho pro caso mais comum: extrair só o conteúdo (sem nome do arquivo)
 * de todas as entradas que batem com a extensão informada.
 */
export function unzipBase64Contents(
  base64Zip: string,
  options: UnzipOptions = {},
): string[] {
  return unzipBase64(base64Zip, options).map((entry) => entry.content);
}