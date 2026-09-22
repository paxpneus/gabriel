export interface MLOrderJobData {
  order: any;
  customer: any;
  attempt?: number;
}

export interface MLOrderDetailResult {
  order_number: string;
  collection_date: Date;
}

// Job da ML-SCRAPING: roda só no container worker-scraping (único com
// Playwright/Chromium instalado — ver Dockerfile, stage `worker-scraping`).
export interface MLScrapingJobData {
  orderId: string;
  numberOrderChannel: string;
}
