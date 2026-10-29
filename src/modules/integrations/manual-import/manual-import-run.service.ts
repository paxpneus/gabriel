import { Op } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import redisService from "../../../shared/utils/base-models/base-redis";
import {
  FINAL_JOB_STATUSES,
  IMPORT_JOB_RESULT,
  toJobStatus,
} from "../../../shared/utils/queues/job-status";
import type { Requester } from "../../../middlewares/auth-token";
import userService from "../../company/users/users/user.service";
import applicationService from "../applications/applications.service";
import { ManualImportError } from "./manual-import.errors";
import {
  MANUAL_IMPORT_JOB_NAME,
  MANUAL_IMPORT_LOCK_TTL_MS,
  MANUAL_IMPORT_RUN_TTL_S,
  MANUAL_IMPORT_WARNINGS,
  manualImportJobId,
  manualImportKeys,
} from "./manual-import.constants";
import {
  ManualImportEntity,
  ManualImportHandler,
  ManualImportItemClaim,
  ManualImportItemResult,
  ManualImportJobRef,
  ManualImportProcessingBy,
  ManualImportQueues,
  ManualImportRun,
  ManualImportRunItem,
  ManualImportRunView,
  ManualImportSavedItem,
} from "./manual-import.types";

// Apaga a chave só se ainda for nossa (lock/claim pode ter sido trocado por outro import).
const DELETE_IF_EQUALS_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

// Troca o claim só se ele ainda tiver o valor lido — evita dois pedidos sobrescrevendo a mesma sobra.
const REPLACE_IF_EQUALS_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("SET", KEYS[1], ARGV[2], "PX", ARGV[3])
end
return false
`;

// Tentativas de reservar um item quando o claim some/muda entre o SET NX e a leitura.
const CLAIM_ATTEMPTS = 3;
// O claim é gravado antes do job existir: claim mais novo que isso sem job ainda está sendo enfileirado, não acabou.
const CLAIM_ENQUEUE_GRACE_MS = 30 * 1000;

// Entrada de start(): itens já validados pela busca (cache ou resultado único).
export interface StartManualImportParams {
  requester: Requester;
  integrationId: string;
  entity: ManualImportEntity;
  handler: ManualImportHandler;
  items: ManualImportSavedItem[];
  queues: ManualImportQueues;
}

// Montado campo a campo: o valor serializado precisa sair idêntico pro compare-and-delete.
function serializeClaim(claim: ManualImportItemClaim): string {
  return JSON.stringify({
    runId: claim.runId,
    requestedBy: { id: claim.requestedBy.id, type: claim.requestedBy.type },
    jobRef: { queue: claim.jobRef.queue, jobId: claim.jobRef.jobId },
  });
}

// Registro → resposta do front; not_found conta como falha.
function toRunView(run: ManualImportRun): ManualImportRunView {
  const items = run.items.map((item) => ({
    externalId: item.externalId,
    label: item.label,
    existsLocally: item.existsLocally,
    status: item.status ?? "waiting",
    ...(item.error ? { error: item.error } : {}),
    ...(item.result ? { result: item.result } : {}),
  }));
  const completed = items.filter((item) => item.status === "completed").length;
  const failed = items.filter(
    (item) => item.status === "failed" || item.status === "not_found",
  ).length;

  return {
    runId: run.runId,
    status: run.status,
    integrationId: run.integrationId,
    entity: run.entity,
    total: items.length,
    done: completed + failed,
    completed,
    failed,
    startedAt: run.startedAt,
    ...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
    items,
  };
}

// Lock por usuário, claim por item e andamento do import — tudo no Redis, sem processo em background.
export class ManualImportRunService {
  // ioredis direto: SET NX/PX, MGET e EVAL não estão no wrapper do redisService.
  private get client() {
    return redisService.client;
  }

  // Import atual ou último do usuário (null se nunca importou ou expirou).
  async getLastRunView(
    requester: Requester,
    queues: ManualImportQueues,
  ): Promise<ManualImportRunView | null> {
    const run = await redisService.get<ManualImportRun>(
      manualImportKeys.userRun(requester.id),
    );
    return run ? this.evaluate(run, queues) : null;
  }

  // Reavalia o import do usuário antes de bloquear: se já terminou, solta o lock e segue.
  async assertNoRunningImport(
    requester: Requester,
    queues: ManualImportQueues,
  ): Promise<void> {
    const lockKey = manualImportKeys.userLock(requester.id);
    const lockOwner = await this.client.get(lockKey);
    if (!lockOwner) return;

    const run = await redisService.get<ManualImportRun>(
      manualImportKeys.userRun(requester.id),
    );
    // Lock sem registro: outro pedido do mesmo usuário acabou de pegar o lock.
    if (!run || run.runId !== lockOwner) {
      throw new ManualImportError(409, {
        code: "USER_IMPORT_RUNNING",
        message: "Você já tem uma importação manual em andamento",
        run: null,
      });
    }

    const view = await this.evaluate(run, queues);
    if (view.status === "RUNNING") {
      throw new ManualImportError(409, {
        code: "USER_IMPORT_RUNNING",
        message: "Você já tem uma importação manual em andamento",
        run: view,
      });
    }
    await this.deleteIfEquals(lockKey, run.runId);
  }

  // Pega o lock do usuário, reserva e enfileira cada item; sem nenhum enfileirado, solta o lock.
  async start(
    params: StartManualImportParams,
  ): Promise<{ run: ManualImportRunView | null; items: ManualImportItemResult[] }> {
    const { requester, integrationId, entity, handler, queues } = params;
    const runId = uuidv4();
    const lockKey = manualImportKeys.userLock(requester.id);

    const acquired = await this.client.set(
      lockKey,
      runId,
      "PX",
      MANUAL_IMPORT_LOCK_TTL_MS,
      "NX",
    );
    if (acquired !== "OK") {
      throw new ManualImportError(409, {
        code: "USER_IMPORT_RUNNING",
        message: "Você já tem uma importação manual em andamento",
        run: await this.getLastRunView(requester, queues),
      });
    }

    try {
      const queue = handler.queueFor(entity);
      const outcomes = await Promise.all(
        params.items.map((item) =>
          this.enqueueItem(params, item, {
            queue,
            jobId: manualImportJobId(entity, item.externalId, runId),
          }, runId),
        ),
      );

      const processingNames = await this.resolveRequesterNames(
        outcomes.flatMap((outcome) =>
          outcome.processingClaim ? [outcome.processingClaim.requestedBy] : [],
        ),
      );
      const items = outcomes.map((outcome) =>
        outcome.processingClaim
          ? {
              ...outcome.result,
              processingBy: {
                ...outcome.processingClaim.requestedBy,
                name: processingNames.get(outcome.processingClaim.requestedBy.id) ?? null,
              },
            }
          : outcome.result,
      );

      // Só o que entrou na fila faz parte do import (os outros já voltaram com o motivo).
      const runItems = outcomes.flatMap((outcome) =>
        outcome.runItem ? [outcome.runItem] : [],
      );
      if (!runItems.length) {
        await this.deleteIfEquals(lockKey, runId);
        return { run: null, items };
      }

      const run: ManualImportRun = {
        runId,
        status: "RUNNING",
        integrationId,
        entity,
        requestedBy: { id: requester.id, type: requester.type },
        startedAt: new Date().toISOString(),
        items: runItems,
      };
      await this.saveRun(run);

      return { run: await this.evaluate(run, queues), items };
    } catch (error) {
      await this.deleteIfEquals(lockKey, runId).catch(() => {});
      throw error;
    }
  }

  // Claims vivos (job ainda não finalizado) dos itens — a busca só lê, não reserva.
  async findProcessingClaims(
    integrationId: string,
    entity: ManualImportEntity,
    externalIds: string[],
    queues: ManualImportQueues,
  ): Promise<Map<string, ManualImportProcessingBy>> {
    if (!externalIds.length) return new Map();

    const raws = await this.client.mget(
      ...externalIds.map((externalId) =>
        manualImportKeys.itemClaim(integrationId, entity, externalId),
      ),
    );
    const claims = await Promise.all(
      raws.map(async (raw, index) => {
        if (!raw) return null;
        const claim = JSON.parse(raw) as ManualImportItemClaim;
        const claimKey = manualImportKeys.itemClaim(integrationId, entity, externalIds[index]);
        return (await this.isClaimReleasable(claimKey, claim.jobRef, queues)) ? null : claim;
      }),
    );

    const names = await this.resolveRequesterNames(
      claims.flatMap((claim) => (claim ? [claim.requestedBy] : [])),
    );
    const processing = new Map<string, ManualImportProcessingBy>();
    claims.forEach((claim, index) => {
      if (!claim) return;
      processing.set(externalIds[index], {
        ...claim.requestedBy,
        name: names.get(claim.requestedBy.id) ?? null,
      });
    });
    return processing;
  }

  // Só avisa; não distingue de quem é o job (nome de job é o mesmo pra todo import manual).
  async hasOtherManualImportsRunning(
    handler: ManualImportHandler,
    queues: ManualImportQueues,
  ): Promise<boolean> {
    const pending = await Promise.all(
      handler.queueKeys.map((key) =>
        queues[key].hasPendingJobsNamed([MANUAL_IMPORT_JOB_NAME]),
      ),
    );
    return pending.some(Boolean);
  }

  // Andamento calculado na hora; com tudo em estado final vira FINISHED e solta lock + claims.
  async evaluate(
    run: ManualImportRun,
    queues: ManualImportQueues,
  ): Promise<ManualImportRunView> {
    if (run.status === "FINISHED") return toRunView(run);

    const items: ManualImportRunItem[] = await Promise.all(
      run.items.map(async (item) => {
        const job = await queues[item.jobRef.queue].getJob(item.jobRef.jobId);
        const { status, error } = await toJobStatus(job);
        return {
          ...item,
          status,
          ...(error ? { error } : {}),
          ...(status === "completed"
            ? { result: job?.returnvalue ?? IMPORT_JOB_RESULT.IMPORTED }
            : {}),
        };
      }),
    );

    const finished = items.every((item) => FINAL_JOB_STATUSES.has(item.status!));
    if (!finished) return toRunView({ ...run, items });

    const finishedRun: ManualImportRun = {
      ...run,
      status: "FINISHED",
      finishedAt: new Date().toISOString(),
      items,
    };
    await this.saveRun(finishedRun);
    await Promise.all([
      this.deleteIfEquals(manualImportKeys.userLock(run.requestedBy.id), run.runId),
      ...run.items.map((item) =>
        this.deleteIfEquals(
          manualImportKeys.itemClaim(run.integrationId, run.entity, item.externalId),
          serializeClaim({
            runId: run.runId,
            requestedBy: run.requestedBy,
            jobRef: item.jobRef,
          }),
        ),
      ),
    ]);
    return toRunView(finishedRun);
  }

  // Valida e enfileira um item: importável → claim livre → add; falha no add libera o claim.
  private async enqueueItem(
    params: StartManualImportParams,
    item: ManualImportSavedItem,
    jobRef: ManualImportJobRef,
    runId: string,
  ): Promise<{
    result: ManualImportItemResult;
    runItem?: ManualImportRunItem;
    processingClaim?: ManualImportItemClaim;
  }> {
    const base = { externalId: item.externalId, label: item.label };

    if (!item.importable) {
      return {
        result: { ...base, status: "NOT_IMPORTABLE", reason: item.reason, warnings: [] },
      };
    }

    const claimKey = manualImportKeys.itemClaim(
      params.integrationId,
      params.entity,
      item.externalId,
    );
    const claimValue = serializeClaim({
      runId,
      requestedBy: params.requester,
      jobRef,
    });
    const existing = await this.claimItem(claimKey, claimValue, params.queues);
    if (existing) {
      return {
        result: { ...base, status: "ALREADY_PROCESSING", warnings: [] },
        processingClaim: existing,
      };
    }

    try {
      await params.handler.enqueue(params.entity, item, jobRef, params.queues);
    } catch (error: any) {
      await this.deleteIfEquals(claimKey, claimValue).catch(() => {});
      return {
        result: { ...base, status: "ENQUEUE_FAILED", reason: error?.message, warnings: [] },
      };
    }

    return {
      result: {
        ...base,
        status: "ENQUEUED",
        warnings: item.existsLocally
          ? [MANUAL_IMPORT_WARNINGS.ALREADY_EXISTS_UPDATING]
          : [],
      },
      runItem: { ...base, existsLocally: item.existsLocally, jobRef },
    };
  }

  // SET NX atômico; claim de job já finalizado é sobra de import anterior e é trocado (compare-and-set).
  private async claimItem(
    claimKey: string,
    claimValue: string,
    queues: ManualImportQueues,
  ): Promise<ManualImportItemClaim | null> {
    for (let attempt = 0; attempt < CLAIM_ATTEMPTS; attempt++) {
      const created = await this.client.set(
        claimKey,
        claimValue,
        "PX",
        MANUAL_IMPORT_LOCK_TTL_MS,
        "NX",
      );
      if (created === "OK") return null;

      const currentRaw = await this.client.get(claimKey);
      if (!currentRaw) continue;

      const current = JSON.parse(currentRaw) as ManualImportItemClaim;
      if (!(await this.isClaimReleasable(claimKey, current.jobRef, queues))) return current;

      const replaced = await this.client.eval(
        REPLACE_IF_EQUALS_SCRIPT,
        1,
        claimKey,
        currentRaw,
        claimValue,
        String(MANUAL_IMPORT_LOCK_TTL_MS),
      );
      if (replaced === "OK") return null;
    }
    throw new Error("Não foi possível reservar o item para importação");
  }

  // Job completed/failed, ou não encontrado num claim antigo (sobra de import anterior); retry do BullMQ (delayed) e
  // claim recente sem job (o outro pedido ainda está enfileirando) contam como pendentes.
  private async isClaimReleasable(
    claimKey: string,
    jobRef: ManualImportJobRef,
    queues: ManualImportQueues,
  ): Promise<boolean> {
    const { status } = await toJobStatus(
      await queues[jobRef.queue].getJob(jobRef.jobId),
    );
    if (!FINAL_JOB_STATUSES.has(status)) return false;
    if (status !== "not_found") return true;

    const claimAgeMs = MANUAL_IMPORT_LOCK_TTL_MS - (await this.client.pttl(claimKey));
    return claimAgeMs >= CLAIM_ENQUEUE_GRACE_MS;
  }

  // id → nome de quem pediu, uma consulta por tipo (user/application) e só o atributo name.
  private async resolveRequesterNames(
    requesters: Requester[],
  ): Promise<Map<string, string>> {
    const idsOf = (type: Requester["type"]) => [
      ...new Set(requesters.filter((r) => r.type === type).map((r) => r.id)),
    ];
    const userIds = idsOf("user");
    const applicationIds = idsOf("application");

    const [users, applications] = await Promise.all([
      userIds.length
        ? userService.findAll({
            where: { id: { [Op.in]: userIds } },
            attributes: ["id", "name"],
          })
        : [],
      applicationIds.length
        ? applicationService.findAll({
            where: { id: { [Op.in]: applicationIds } },
            attributes: ["id", "name"],
          })
        : [],
    ]);

    return new Map(
      [...users, ...applications].map((record) => [record.id, record.name]),
    );
  }

  // Registro do import no Redis, chave por usuário.
  private async saveRun(run: ManualImportRun): Promise<void> {
    await redisService.set(manualImportKeys.userRun(run.requestedBy.id), run, {
      mode: "EX",
      duration: MANUAL_IMPORT_RUN_TTL_S,
    });
  }

  // Compare-and-delete atômico (ver DELETE_IF_EQUALS_SCRIPT).
  private async deleteIfEquals(key: string, value: string): Promise<void> {
    await this.client.eval(DELETE_IF_EQUALS_SCRIPT, 1, key, value);
  }
}

export default new ManualImportRunService();
