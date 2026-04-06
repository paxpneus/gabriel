import { Job } from "bullmq";
import { BaseQueueService } from "../../utils/base-models/base-queue-service";
import { sendMailDto } from "./nodemailer.types";
import nodemailerService from "./nodemailer.service";
export class NodeMailerQueue extends BaseQueueService<sendMailDto> {

  constructor() {
    super("NODE-MAILER-QUEUE");
  }

  async process(job: Job<sendMailDto>): Promise<void> {
    try {
      if (!job.data || !job.data.to) {
        
        throw new Error('[NODEMAILER QUEUE 400] Dados do e-mail inválidos ou destinário não preenchido')
      }

      await nodemailerService.send(job.data);

    } catch (error: any) {
        throw error;
    }
  }
}
