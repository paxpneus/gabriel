// // modules/handlers/logistics/queues/datafrete-sync.queue.ts
// import { Queue, Worker, Job } from "bullmq";
// import { DatafreteService } from "../services/datafrete.service";

// interface DatafreteSyncQueueOptions {
//   workless?: boolean;
// }

// export class DatafreteSyncQueue {
//   public queue: Queue;
//   private worker?: Worker;

//   constructor(
//     private datafreteService: DatafreteService,
//     options: DatafreteSyncQueueOptions = {},
//   ) {
//     this.queue = new Queue("datafrete-sync", { connection: redisConnection });

//     if (!options.workless) {
//       this.worker = new Worker(
//         "datafrete-sync",
//         async (job: Job) => this.process(job),
//         { connection: redisConnection, concurrency: 1 }, // 1 por vez: evita duplicar envio pro batch
//       );
//     }
//   }

//   private async process(_job: Job) {
//     const pending = await db.query(`
//       SELECT o.*, i.chave_nf, i.numero_nf, i.serie_nf, i.transportador_cnpj, i.empresa_cnpj
//       FROM invoice_logistic_occurrences o
//       JOIN invoices i ON i.id = o.invoice_id
//       WHERE o.status = 'PENDING'
//     `);

//     // agrupa por nota fiscal
//     const byInvoice = new Map<string, { invoice: any; occurrences: any[] }>();
//     for (const row of pending) {
//       const key = row.invoice_id;
//       if (!byInvoice.has(key)) byInvoice.set(key, { invoice: row, occurrences: [] });
//       byInvoice.get(key)!.occurrences.push(row);
//     }

//     if (byInvoice.size === 0) return;

//     const result = await this.datafreteService.sync(byInvoice);

//     if (result.ok) {
//       const allIds = [...byInvoice.values()].flatMap((v) => v.occurrences.map((o) => o.id));
//       await db.query(
//         `UPDATE invoice_logistic_occurrences SET status = 'SYNCHRONIZED' WHERE id = ANY($1)`,
//         [allIds],
//       );
//     } else {
//       console.error(`[DATAFRETE_SYNC] falha no envio, status ${result.status}`);
//       // fica PENDING e tenta de novo na próxima hora
//     }
//   }

//   scheduleRepeat({ every }: { every: number }) {
//     return this.queue.add(
//       "run",
//       {},
//       { repeat: { every }, jobId: "datafrete-sync-repeat" },
//     );
//   }
// }