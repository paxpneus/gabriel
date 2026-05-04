import { Job } from "bullmq";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { doRefreshToken } from "../../../api/bling_api.service";
import { alertService } from "../../../../../../shared/providers/mail-provider/nodemailer.alert";

export class BlingTokenRefreshQueue extends BaseQueueService<void> {

    constructor(options: { workless?: boolean } = {}) {
        super('BLING_TOKEN_REFRESH', {
            concurrency: 1,
            workless: options.workless
        })
    }

    async process(job: Job<void, void, string>): Promise<void> {
        console.log(`[BlingTokenRefreshQueue] Renovando token... jobId=${job.id}`)

        try {
            await doRefreshToken()
            console.log(`[BlingTokenRefreshQueue] Token renovado com sucesso em ${new Date().toISOString()}`)
        } catch (err) {
            alertService.sendAlert({
                severity: 'CRITICAL',
                title: 'Bling — refresh proativo falhou',
                message: `Erro ao renovar token automaticamente: ${err}`,
            })
            throw err
        }
    }
}