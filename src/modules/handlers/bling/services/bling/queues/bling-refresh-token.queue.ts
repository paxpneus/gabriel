import { Job } from "bullmq";
import { Op } from "sequelize";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { doRefreshToken } from "../../../api/bling_api.service";
import { alertService } from "../../../../../../shared/providers/mail-provider/nodemailer.alert";
import { Invoice } from "../../../../../warehouse";

export class BlingTokenRefreshQueue extends BaseQueueService<void> {

    constructor(options: { workless?: boolean } = {}) {
        super('BLING_TOKEN_REFRESH', {
            concurrency: 1,
             lockDuration: 60_000,
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

        try {
            const today = new Date().toISOString().split('T')[0]; 

            const [updated] = await Invoice.update(
                { status: 'LATE' },
                {
                    where: {
                        type: 'INCOMING',
                        status: { [Op.notIn]: ['FINISHED', 'CANCELLED', 'LATE', 'OPEN', 'PENDING'] },
                        expected_receiving: { [Op.lt]: today },
                        batch_generated: false,
                    },
                }
            );

            if (updated > 0) {
                console.log(`[BlingTokenRefreshQueue] ${updated} invoice(s) marcada(s) como LATE`)
            }
        } catch (err) {
            console.error(`[BlingTokenRefreshQueue] Erro ao marcar invoices como LATE:`, err)
        }
    }
}
