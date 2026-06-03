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

    const path = `${directory}/${filename}`;

    await this.api.put(path, file.buffer, {
      timeout: file.timeoutMs,
      headers: {
        'Content-Type': file.mimeType
      }
    });

    return path;
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
