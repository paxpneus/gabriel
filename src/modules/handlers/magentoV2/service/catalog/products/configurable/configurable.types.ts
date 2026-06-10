export interface MagentoConfigurableOption {
  attribute_id: string;
  label: string;
  position: number;
  values: { value_index: number }[];
}