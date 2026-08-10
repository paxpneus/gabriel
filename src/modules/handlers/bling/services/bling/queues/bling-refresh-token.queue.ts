import { Job } from "bullmq";
import { Op } from "sequelize";
import { BaseQueueService } from "../../../../../../shared/utils/base-models/base-queue-service";
import { doRefreshToken } from "../../../api/bling_api.service";
import { alertService } from "../../../../../../shared/providers/mail-provider/nodemailer.alert";
import { Invoice } from "../../../../../warehouse";
import invoiceService from "../../../../../warehouse/fiscal/invoices/invoice/invoice.service";

export class BlingTokenRefreshQueue extends BaseQueueService<void> {
  constructor(options: { workless?: boolean } = {}) {
    super("BLING_TOKEN_REFRESH", {
      concurrency: 1,
      lockDuration: 60_000,
      workless: options.workless,
    });
  }

  async process(job: Job<void, void, string>): Promise<void> {
    console.log(`[BlingTokenRefreshQueue] Renovando token... jobId=${job.id}`);

    try {
      await doRefreshToken();
      console.log(
        `[BlingTokenRefreshQueue] Token renovado com sucesso em ${new Date().toISOString()}`,
      );
    } catch (err) {
      alertService.sendAlert({
        severity: "CRITICAL",
        title: "Bling — refresh proativo falhou",
        message: `Erro ao renovar token automaticamente: ${err}`,
      });
      throw err;
    }

    try {
      const today = new Date().toISOString().split("T")[0];

      const invoices = await Invoice.findAll({
        where: {
          expected_receiving: { [Op.lt]: today },
        },
        include: [
          {
            association: "unitBusinessAttributes",
            where: {
              batch_generated: false,
              type: "INCOMING",
              status: {
                [Op.notIn]: [
                  "FINISHED",
                  "CANCELLED",
                  "LATE",
                  "OPEN",
                  "PENDING",
                ],
              },
            },
            required: true,
          },
        ],
      });

      if (invoices.length > 0) {
        await invoiceService.updateInvoicesForAllUnitBusiness(
          invoices.map((i) => i.id),
          { status: "LATE" },
          { type: "INCOMING" }, 
        );

        console.log(
          `[BlingTokenRefreshQueue] ${invoices.length} invoice(s) marcada(s) como LATE`,
        );
      }
    } catch (err) {
      console.error(
        `[BlingTokenRefreshQueue] Erro ao marcar invoices como LATE:`,
        err,
      );
    }
  }
}
