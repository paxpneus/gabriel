import { CNPJService } from './cnpj.service';
import { BaseQueueService } from "../../../../shared/utils/base-models/base-queue-service";
import { Job } from 'bullmq';

export class CNPJQueue extends BaseQueueService<any> {
    private CNPJService;

    constructor(cnpjService: CNPJService) {
        super('CNPJ_VERIFY_CNAE')
        this.CNPJService = cnpjService
    }

    async process(job: Job<any, any, string>): Promise<void> {
        console.log(`[QUEUE] Processando verificação de cnpj de pedido ${job.id}`)
        const verifiyCNPJ = await this.CNPJService.checkCNAE(job.data.cnaes, job.data.customer.document)

        if (verifiyCNPJ) {
            console.log('PROXIMA FILA')
        } else {
            console.log('MARCAR COM STATUS NA BLING')
        }
    }
}