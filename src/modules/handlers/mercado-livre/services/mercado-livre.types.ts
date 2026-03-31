export interface MLOrderData {
  ml_order_id: string;
  collection_date: Date;
  // outros campos que o ML retornar futuramente
}

export interface MLOrderJobData {
  order: any;
  customer: any;
  attempt?: number;
}

export interface MLScrapingJobData {
    triggered_by?: string; 
}

export interface MLExcelRow {
    order_number: string;
    collection_date: Date;
}