export interface MLOrderJobData {
  order: any;
  customer: any;
  attempt?: number;
}

export interface MLOrderDetailResult {
  order_number: string;
  collection_date: Date;
}
