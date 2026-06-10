import { MagentoCustomAttribute } from "../common.types";

export interface MagnentoCategoryPayload {
  name: string;
  is_active?: boolean;
  parent_id?: number;
  position?: number;
  custom_attributes?: MagentoCustomAttribute[];
  [key: string]: unknown;
}