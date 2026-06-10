import { MagentoCustomAttribute } from "./common.types";

export interface MagentoProductPayload {
  sku: string;
  name?: string;
  price?: number;
  status?: 1 | 2;
  visibility?: 1 | 2 | 3 | 4;
  type_id?: "simple" | "configurable" | "virtual" | "downloadable" | "bundle";
  attribute_set_id?: number;
  weight?: number;
  custom_attributes?: MagentoCustomAttribute[];
  [key: string]: unknown;
}

export type MagentoLinkType = "related" | "upsell" | "crosssell" | "associated";