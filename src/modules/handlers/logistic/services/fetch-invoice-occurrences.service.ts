// // modules/handlers/logistics/services/invoice-logistic-occurrences.service.ts

// interface EligibleInvoice {
//   id: string;
//   chaveNf: string | null;
//   numeroNf: string;
//   serieNf: string;
//   transportadorCnpj: string;
//   empresaCnpj: string;
//   romaneioGeradoEm: Date;
// }

// export class InvoiceLogisticOccurrencesService {
//   // Regra de elegibilidade da Rotina 1
//   async findEligibleInvoices(): Promise<EligibleInvoice[]> {
//     // pseudo-SQL — adaptar pro seu ORM/query builder
//     return db.query(`
//       SELECT i.*
//       FROM invoices i
//       WHERE i.romaneio_generated_at IS NOT NULL
//         AND (
//           -- (1) recentes sem NENHUMA ocorrência
//           (
//             i.romaneio_generated_at >= NOW() - INTERVAL '5 days'
//             AND NOT EXISTS (
//               SELECT 1 FROM invoice_logistic_occurrences o
//               WHERE o.invoice_id = i.id
//             )
//           )
//           OR
//           -- (2) pendentes de entrega (trava 45 dias)
//           (
//             i.romaneio_generated_at >= NOW() - INTERVAL '45 days'
//             AND NOT EXISTS (
//               SELECT 1 FROM invoice_logistic_occurrences o
//               WHERE o.invoice_id = i.id
//                 AND o.occurrence_code = :DELIVERED_CODE
//             )
//           )
//         )
//     `);
//   }

//   // UPSERT das ocorrências vindas da API da transportadora
//   async upsertOccurrences(invoiceId: string, occurrences: any[]) {
//     for (const occ of occurrences) {
//       await db.query(`
//         INSERT INTO invoice_logistic_occurrences
//           (invoice_id, occurrence_code, description, occurred_at, status, external_ref)
//         VALUES ($1, $2, $3, $4, 'PENDING', $5)
//         ON CONFLICT (invoice_id, occurrence_code, occurred_at) -- ajuste a chave de conflito real
//         DO UPDATE SET description = EXCLUDED.description
//       `, [invoiceId, occ.code, occ.description, occ.occurredAt, occ.externalRef]);
//     }
//   }
// }