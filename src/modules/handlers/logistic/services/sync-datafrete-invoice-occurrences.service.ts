// // modules/handlers/logistics/services/datafrete.service.ts

// import { formatToBRDate } from "../../../../shared/utils/normalizers/date";

// interface DatafreteOcorrencia {
//   codigo_ocorrencia: string;
//   link_comprovante?: string;
//   descricao_ocorrencia?: string;
//   data_ocorrencia: string; // "YYYY-MM-DD HH:mm:ss"
// }

// interface DatafreteDocumento {
//   transportador_cnpj: string;
//   empresa_cnpj: string;
//   chave_nf: string; // fallback: numero+serie quando não houver chave
//   ocorrencias: DatafreteOcorrencia[];
// }

// export class DatafreteService {
//   async sync(pendingByInvoice: Map<string, { invoice: any; occurrences: any[] }>) {
//     const documentos: DatafreteDocumento[] = [];

//     for (const [, { invoice, occurrences }] of pendingByInvoice) {
//       documentos.push({
//         transportador_cnpj: invoice.transportadorCnpj,
//         empresa_cnpj: invoice.empresaCnpj,
//         chave_nf: invoice.chaveNf ?? `${invoice.numeroNf}${invoice.serieNf}`,
//         ocorrencias: occurrences.map((o) => ({
//           codigo_ocorrencia: o.occurrenceCode,
//           link_comprovante: o.proofLink,
//           descricao_ocorrencia: o.description,
//           data_ocorrencia: formatToBRDate(o.occurredAt), 
//         })),
//       });
//     }

//     const response = await fetch("https://api.datafrete.com/.../ocorrencias", {
//       method: "POST",
//       headers: { "Content-Type": "application/json", Authorization: `Bearer ${DATAFRETE_TOKEN}` },
//       body: JSON.stringify({ documentos }),
//     });

//     return { ok: response.status === 200 || response.status === 201, status: response.status };
//   }
// }