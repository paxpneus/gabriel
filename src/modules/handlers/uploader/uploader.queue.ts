import { Job } from "bullmq";
import { Op } from "sequelize";
import { BaseQueueService } from "../../../shared/utils/base-models/base-queue-service";
import uploaderService from "./services/uploader.service";
import { UploadInput } from "./services/uploader.service";
import tempFileService from "../temp-file/temp-file.service";
import TempFile from "../temp-file/temp-file.model";
import { UploaderDeleteTarget } from "../temp-file/temp-file.constants";
import { TempFileEntityType } from "../../../shared/constants/temp-file-entity-type";
import { buildEntityCacheKey, invalidateCachedImage } from "./uploader-image-cache";
import { FINALIZERS, FINALIZE_CHECKERS } from "./uploader-finalizers";
import { UploaderPriorityCategory, resolveUploaderPriority } from "./uploader-priority";

// Ver .claude/modules/uploader-queue.md pro desenho completo.
const RECONCILE_AGE_MS = Number(process.env.UPLOADER_RECONCILE_AGE_MS ?? 15 * 60 * 1000);
const RECONCILE_MAX_ATTEMPTS = Number(process.env.UPLOADER_RECONCILE_MAX_ATTEMPTS ?? 5);

type UploaderJobData =
  | { kind: "upload"; tempFileId: string }
  | { kind: "delete"; target: UploaderDeleteTarget; cacheKey?: string }
  | { kind: "reconcile" };

export class UploaderQueue extends BaseQueueService<UploaderJobData, string | void> {
  constructor(options: { workless?: boolean } = {}) {
    super("UPLOADER", {
      concurrency: 3,
      // Throttling compartilhado por todos os consumidores (upload+delete).
      limiter: { max: 3, duration: 5000 },
      workless: options.workless,
    });
  }

  async process(job: Job<UploaderJobData>): Promise<string | void> {
    if (job.data.kind === "upload") return this.processUpload(job.data.tempFileId);
    if (job.data.kind === "delete") return this.processDelete(job.data);
    return this.processReconcile();
  }

  private async processUpload(tempFileId: string): Promise<string> {
    const tempFile = await tempFileService.findById(tempFileId);
    if (!tempFile) return ""; // já finalizado/apagado (delete concorrente) — não é erro

    const cacheKey = tempFile.entity_type
      ? buildEntityCacheKey(tempFile.entity_type, tempFile.entity_id!)
      : undefined;

    const realPath = await uploaderService.upload({
      buffer: tempFile.buffer,
      filename: tempFile.original_filename,
      mimeType: tempFile.mime_type,
      directory: tempFile.upload_directory ?? undefined,
      preserveFilename: tempFile.preserve_filename,
      cacheKey,
    });

    if (tempFile.entity_type) {
      const updated = await FINALIZERS[tempFile.entity_type](tempFile.entity_id!, realPath);
      // entidade de destino sumiu entre o attach e o job rodar — desfaz.
      if (!updated) await uploaderService.delete(realPath, cacheKey).catch(() => {});
    }

    await tempFileService.delete(tempFileId);
    return realPath; // lido por quem chamou uploadAndWait
  }

  private async processDelete(
    data: Extract<UploaderJobData, { kind: "delete" }>,
  ): Promise<void> {
    if (data.target.type === "temp-file") {
      await tempFileService.delete(data.target.tempFileId).catch(() => {});
      if (data.cacheKey) await invalidateCachedImage(data.cacheKey);
      return;
    }
    await uploaderService.delete(data.target.path, data.cacheKey);
  }

  // Ver .claude/modules/uploader-queue.md ("Sweep de reconciliação") pros 4 casos.
  private async processReconcile(): Promise<void> {
    const cutoff = new Date(Date.now() - RECONCILE_AGE_MS);

    const staleTempFiles = await tempFileService.findAll({
      where: { createdAt: { [Op.lt]: cutoff } },
      attributes: ["id", "entity_type", "entity_id", "reconcile_attempts", "original_filename"],
    });

    for (const tempFile of staleTempFiles) {
      if (!tempFile.entity_type) {
        await this.reconcileWithoutEntity(tempFile);
        continue;
      }
      await this.reconcileWithEntity(tempFile);
    }
  }

  // Caso D: sem entity_type (uploadAndWait) — nunca reenfileira, só limpa e loga.
  private async reconcileWithoutEntity(tempFile: TempFile): Promise<void> {
    const job = await this.queue.getJob(tempFile.id);
    const state = job ? await job.getState() : null;
    if (
      state === "waiting" ||
      state === "active" ||
      state === "delayed" ||
      state === "prioritized"
    ) {
      return; // ainda em andamento/retry de verdade
    }

    console.error(
      `[UploaderQueue][Reconcile] temp_files órfão sem entidade (job=${state ?? "não encontrado"}) — ` +
        `id=${tempFile.id}, arquivo=${tempFile.original_filename}`,
    );
    await tempFileService.delete(tempFile.id);
  }

  // Casos A/B/C: com entity_type (PDV/unmapped) — consulta o estado atual da entidade.
  private async reconcileWithEntity(tempFile: TempFile): Promise<void> {
    const state = await FINALIZE_CHECKERS[tempFile.entity_type!](tempFile.entity_id!);

    if (state === "missing") {
      console.warn(
        `[UploaderQueue][Reconcile] entidade de destino não existe mais — apagando temp_files órfão id=${tempFile.id}`,
      );
      await tempFileService.delete(tempFile.id);
      return;
    }

    if (state === "already-real") {
      console.info(
        `[UploaderQueue][Reconcile] upload já concluído, temp_files não foi limpo — apagando id=${tempFile.id}`,
      );
      await tempFileService.delete(tempFile.id);
      return;
    }

    const attempts = tempFile.reconcile_attempts + 1;
    await tempFileService.update(tempFile.id, { reconcile_attempts: attempts });

    if (attempts > RECONCILE_MAX_ATTEMPTS) {
      console.error(
        `[UploaderQueue][Reconcile] temp_files id=${tempFile.id} esgotou ${RECONCILE_MAX_ATTEMPTS} tentativas ` +
          `de reconciliação — parando de tentar, requer investigação manual`,
      );
      return;
    }

    await this.enqueueUpload(tempFile.id, tempFile.entity_type!);
  }

  // Staging com finalização automática (PDV/unmapped) — prioridade vem do entityType.
  async enqueueUpload(tempFileId: string, entityType: TempFileEntityType): Promise<void> {
    await this.add({ kind: "upload", tempFileId }, tempFileId, {
      priority: resolveUploaderPriority(entityType),
    });
  }

  // Troca 1:1 de uploaderService.upload(input) — cria staging sem entidade e
  // espera via job.waitUntilFinished (ver .claude/modules/uploader-queue.md).
  async uploadAndWait(
    input: UploadInput,
    category: UploaderPriorityCategory,
    timeoutMs = 120_000,
  ): Promise<string> {
    const tempFile = await tempFileService.create({
      buffer: input.buffer,
      mime_type: input.mimeType,
      original_filename: input.filename,
      upload_directory: input.directory ?? null,
      preserve_filename: input.preserveFilename ?? false,
      entity_type: null,
      entity_id: null,
    });

    const job = await this.add({ kind: "upload", tempFileId: tempFile.id }, tempFile.id, {
      priority: resolveUploaderPriority(category),
    });
    return (await job.waitUntilFinished(this.queueEvents, timeoutMs)) as string;
  }

  // Como uploadAndWait, mas sem esperar — pra fluxos sem entidade/campo pra
  // finalizar (ex: cte-upsert.service.ts, onde ninguém consulta o path depois).
  async uploadFireAndForget(input: UploadInput, category: UploaderPriorityCategory): Promise<void> {
    const tempFile = await tempFileService.create({
      buffer: input.buffer,
      mime_type: input.mimeType,
      original_filename: input.filename,
      upload_directory: input.directory ?? null,
      preserve_filename: input.preserveFilename ?? false,
      entity_type: null,
      entity_id: null,
    });

    await this.add({ kind: "upload", tempFileId: tempFile.id }, tempFile.id, {
      priority: resolveUploaderPriority(category),
    });
  }

  // Fire-and-forget, usado por todo fluxo de delete.
  async enqueueDelete(
    target: UploaderDeleteTarget,
    category: UploaderPriorityCategory,
    cacheKey?: string,
  ): Promise<void> {
    await this.add({ kind: "delete", target, cacheKey }, undefined, {
      priority: resolveUploaderPriority(category),
    });
  }
}

// workless:true explícito — sem isso, todo processo que importar este singleton sobe um Worker de verdade.
export default new UploaderQueue({ workless: true });
