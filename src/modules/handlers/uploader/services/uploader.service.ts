import { AxiosInstance } from "axios";
import { randomUUID } from "node:crypto";
import uploaderApi from "../api/uploader_api";

export type UploadInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
};

export class UploaderService {
  constructor(private api: AxiosInstance) {}

  async upload(file: UploadInput) {
    const extension = file.mimeType.split('/')[1] || 'bin';
    const filename = `${randomUUID()}.${extension}`;

    const path = `/uploads/${filename}`;

    await this.api.put(path, file.buffer, {
      headers: {
        'Content-Type': file.mimeType
      }
    });

    return path;
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