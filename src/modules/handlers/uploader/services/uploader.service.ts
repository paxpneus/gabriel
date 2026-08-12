import { AxiosInstance } from "axios";
import { randomUUID } from "node:crypto";
import uploaderApi from "../api/uploader_api";

export type UploadInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  directory?: string;
  preserveFilename?: boolean;
  timeoutMs?: number;
};

export class UploaderService {
  constructor(private api: AxiosInstance) {}

  async upload(file: UploadInput) {
    const extension = file.mimeType.split('/')[1] || 'bin';
    const filename = file.preserveFilename
      ? this.sanitizeFilename(file.filename)
      : `${randomUUID()}.${extension}`;
    const directory = this.normalizeDirectory(file.directory ?? "/uploads");

    await this.ensureDirectoryExists(directory);

    const path = `${directory}/${filename}`;

    await this.api.put(path, file.buffer, {
      timeout: file.timeoutMs,
      headers: {
        'Content-Type': file.mimeType
      }
    });

    return path;
  }

  // WebDAV exige que cada nível da pasta exista antes do PUT do arquivo.
  // MKCOL cria um segmento por vez; se já existir, o servidor responde
  // 405 (Method Not Allowed) — tratamos isso como sucesso silencioso.
  private async ensureDirectoryExists(directory: string): Promise<void> {
    const segments = directory.split('/').filter(Boolean);
    let currentPath = '';

    for (const segment of segments) {
      currentPath += `/${segment}`;

      try {
        await this.api.request({
          method: 'MKCOL',
          url: currentPath,
        });
      } catch (error: any) {
        const status = error.response?.status;

        if (status !== 405) {
          throw new Error(
            `Erro ao criar diretório "${currentPath}" no storage: ${error.message}`,
          );
        }
      }
    }
  }

  private normalizeDirectory(directory: string): string {
    const normalized = directory.trim().replace(/\/+$/, "");

    if (!normalized) return "/uploads";

    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }

  private sanitizeFilename(filename: string): string {
    return filename.replace(/[\\/]/g, "-");
  }

  async getFile(path: string): Promise<Buffer> {
    const response = await this.api.get(path, {
      responseType: 'arraybuffer'
    });

    return Buffer.from(response.data);
  }

  async delete(path: string): Promise<void> {
    try {
      await this.api.delete(path);
    } catch (error: any) {
      if (error.response?.status === 404) {
        return;
      }

      throw new Error(`Erro ao deletar arquivo: ${error}`);
    }
  }
}

export default new UploaderService(uploaderApi);