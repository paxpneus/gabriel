import { AxiosInstance } from "axios";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import uploaderApi from "../api/uploader_api";
import { getCachedImage, setCachedImage, invalidateCachedImage } from "../uploader-image-cache";

export type UploadInput = {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  directory?: string;
  preserveFilename?: boolean;
  timeoutMs?: number;
  // Opcional — quem passar ganha cache automático (ver uploader-image-cache.ts).
  cacheKey?: string;
};

export type UploadStreamInput = {
  stream: Readable;
  filename: string;
  mimeType: string;
  directory?: string;
  preserveFilename?: boolean;
  timeoutMs?: number;
};

const PROPFIND_TIMEOUT_MS = 120_000;
const PROPFIND_NAMES_BODY =
  '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/></d:prop></d:propfind>';
const HREF_PATTERN = /<(?:[A-Za-z0-9]+:)?href>([^<]+)<\/(?:[A-Za-z0-9]+:)?href>/g;

export class UploaderService {
  // Diretórios já confirmados via MKCOL nesta vida do processo — evita
  // reemitir o MKCOL a cada upload pra um diretório que não muda, reduzindo
  // volume de requisições contra a conta no Nextcloud.
  private knownDirectories = new Set<string>();

  constructor(private api: AxiosInstance) {}

  async upload(file: UploadInput) {
    const { directory, path } = this.resolveTarget(file);

    await this.ensureDirectoryExists(directory);

    await this.api.put(path, file.buffer, {
      timeout: file.timeoutMs,
      headers: {
        'Content-Type': file.mimeType
      }
    });

    if (file.cacheKey) {
      // buffer já em memória — sem round-trip extra no WebDAV pra cachear
      const cacheExtension = file.mimeType.split('/')[1] || 'bin';
      await setCachedImage(file.cacheKey, file.buffer, cacheExtension);
    }

    return path;
  }

  // Idempotente: só sobe se o destino ainda não existe. Exige preserveFilename
  // (nome aleatório nunca colide, então a checagem não faria sentido).
  async uploadIfMissing(file: UploadInput): Promise<string> {
    if (!file.preserveFilename) {
      throw new Error("uploadIfMissing exige preserveFilename: true");
    }

    const { path } = this.resolveTarget(file);
    if (await this.exists(path)) return path;

    return this.upload(file);
  }

  // Como upload(), mas recebe um stream em vez de Buffer — nunca materializa
  // o arquivo inteiro em memória (usado pelo dump de backup, que pode ter
  // vários GB). Por isso não passa pela UploaderQueue: um job BullMQ precisa
  // serializar seus dados no Redis, e um stream de processo filho não serializa.
  async uploadStream(file: UploadStreamInput): Promise<string> {
    const { directory, path } = this.resolveTarget(file);

    await this.ensureDirectoryExists(directory);

    await this.api.put(path, file.stream, {
      timeout: file.timeoutMs,
      headers: {
        'Content-Type': file.mimeType
      }
    });

    return path;
  }

  // PROPFIND Depth 1: UMA request lista o diretório inteiro (evita um HEAD por arquivo).
  async listFileNames(directory: string): Promise<Set<string>> {
    try {
      const response = await this.api.request({
        method: 'PROPFIND',
        url: this.normalizeDirectory(directory),
        headers: { Depth: '1', 'Content-Type': 'application/xml' },
        data: PROPFIND_NAMES_BODY,
        responseType: 'text',
        timeout: PROPFIND_TIMEOUT_MS,
      });

      const names = new Set<string>();
      for (const match of String(response.data).matchAll(HREF_PATTERN)) {
        const name = decodeURIComponent(match[1].replace(/\/+$/, '')).split('/').pop();
        if (name) names.add(name);
      }
      return names;
    } catch (error: any) {
      if (error.response?.status === 404) return new Set();

      throw new Error(`Erro ao listar diretório "${directory}" no storage: ${error.message}`);
    }
  }

  private resolveTarget(file: {
    filename: string;
    mimeType: string;
    directory?: string;
    preserveFilename?: boolean;
  }): { directory: string; path: string } {
    const extension = file.mimeType.split('/')[1] || 'bin';
    const filename = file.preserveFilename
      ? this.sanitizeFilename(file.filename)
      : `${randomUUID()}.${extension}`;
    const directory = this.normalizeDirectory(file.directory ?? "/uploads");

    return { directory, path: `${directory}/${filename}` };
  }

  // WebDAV exige que cada nível da pasta exista antes do PUT do arquivo.
  // MKCOL cria um segmento por vez; se já existir, o servidor responde
  // 405 (Method Not Allowed) — tratamos isso como sucesso silencioso.
  private async ensureDirectoryExists(directory: string): Promise<void> {
    const segments = directory.split('/').filter(Boolean);
    let currentPath = '';

    for (const segment of segments) {
      currentPath += `/${segment}`;

      if (this.knownDirectories.has(currentPath)) continue;

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

      this.knownDirectories.add(currentPath);
    }
  }

  normalizeDirectory(directory: string): string {
    const normalized = directory.trim().replace(/\/+$/, "");

    if (!normalized) return "/uploads";

    return normalized.startsWith("/") ? normalized : `/${normalized}`;
  }

  private sanitizeFilename(filename: string): string {
    return filename.replace(/[\\/]/g, "-");
  }

  async getFile(path: string, cacheKey?: string): Promise<Buffer> {
    if (cacheKey) {
      const cached = await getCachedImage(cacheKey);
      if (cached) return cached.buffer;
    }

    const response = await this.api.get(path, {
      responseType: 'arraybuffer'
    });
    const buffer = Buffer.from(response.data);

    if (cacheKey) {
      const extension = path.split('.').pop() || 'bin';
      await setCachedImage(cacheKey, buffer, extension);
    }

    return buffer;
  }

    async exists(path: string): Promise<boolean> {
    try {
      await this.api.head(path);
      return true;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return false;
      }

      throw new Error(`Erro ao verificar existência do arquivo "${path}" no storage: ${error.message}`);
    }
  }

  async delete(path: string, cacheKey?: string): Promise<void> {
    try {
      await this.api.delete(path);
    } catch (error: any) {
      if (error.response?.status !== 404) {
        throw new Error(`Erro ao deletar arquivo: ${error}`);
      }
    }

    if (cacheKey) await invalidateCachedImage(cacheKey);
  }
}

export default new UploaderService(uploaderApi);