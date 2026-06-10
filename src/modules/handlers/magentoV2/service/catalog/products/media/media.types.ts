export interface MagentoMediaEntry {
  media_type: "image" | "video";
  label: string;
  position: number;
  disabled: boolean;
  types: string[];
  content?: {
    base64_encoded_data: string;
    type: string; // "image/jpeg" | "image/png" etc.
    name: string;
  };
}