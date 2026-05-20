export interface DailyOperationReportFilters {
  date: string;
  unitBusinessId?: string;
  transporterId?: string;
  drillDown?: boolean;
}

export interface DailyOperationJobResult {
  jobName: string;
  startedAt: Date;
  lastProcessedAt: Date;
  invoicesProcessed: number;
}

export interface AffectedFactKey {
  fact_date: string;
  unit_business_id: string;
}

export interface AffectedTransporterFactKey extends AffectedFactKey {
  transporter_id: string;
}
