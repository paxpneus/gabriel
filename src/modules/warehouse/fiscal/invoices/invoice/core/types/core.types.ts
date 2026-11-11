// Uma linha de countPendingBatchByTransporter (notas PENDING/OPEN sem
// romaneio gerado, agrupadas por transportadora).
export interface PendingBatchByTransporterRow {
  transporter_id: string | null;
  transporter_name: string | null;
  quantity: number;
}
