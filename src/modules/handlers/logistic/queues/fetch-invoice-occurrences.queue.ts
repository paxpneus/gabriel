// // modules/handlers/logistics/queues/fetch-invoice-occurrences.queue.ts
// import { Queue, Worker, Job } from "bullmq";
// import { InvoiceLogisticOccurrencesService } from "../services/invoice-logistic-occurrences.service";
// import { carrierApi } from "../services/carrier-api.service"; // API da transportadora

// interface FetchInvoiceOccurrencesQueueOptions {
//   workless?: boolean;
// }

// export class FetchInvoiceOccurrencesQueue {
//   public queue: Queue;
//   private worker?: Worker;

//   constructor(
//     private service: InvoiceLogisticOccurrencesService,
//     options: FetchInvoiceOccurrencesQueueOptions = {},
//   ) {
//     this.queue = new Queue("fetch-invoice-occurrences", { connection: redisConnection });

//     if (!options.workless) {
//       this.worker = new Worker(
//         "fetch-invoice-occurrences",
//         async (job: Job) => this.process(job),
//         { connection: redisConnection, concurrency: 5 },
//       );
//     }
//   }

//   private async process(_job: Job) {
//     const invoices = await this.service.findEligibleInvoices();

//     for (const invoice of invoices) {
//       try {
//         const occurrences = await carrierApi.fetchOccurrences({
//           chaveNf: invoice.chaveNf,
//           numeroNf: invoice.numeroNf,
//           serieNf: invoice.serieNf,
//         });

//         await this.service.upsertOccurrences(invoice.id, occurrences);
//       } catch (err) {
//         console.error(`[FETCH_INVOICE_OCCURRENCES] erro na NF ${invoice.id}:`, err);
//         // não interrompe o lote — segue pra próxima nota
//       }
//     }
//   }

//   scheduleRepeat({ every }: { every: number }) {
//     return this.queue.add(
//       "run",
//       {},
//       { repeat: { every }, jobId: "fetch-invoice-occurrences-repeat" },
//     );
//   }
// }