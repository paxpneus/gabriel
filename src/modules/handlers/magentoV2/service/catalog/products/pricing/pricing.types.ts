export interface MagentoTierPrice {
  price: number;
  price_type: "fixed" | "discount";
  website_id: number;
  sku: string;
  customer_group: string;
  quantity: number;
}

export interface MagentoSpecialPrice {
  price: number;
  store_id: number;
  sku: string;
  price_from: string; // "YYYY-MM-DD HH:MM:SS"
  price_to: string;
}