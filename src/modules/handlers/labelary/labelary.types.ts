export type LabelaryDensity = "6dpmm" | "8dpmm" | "12dpmm" | "24dpmm";
export type LabelaryResponseFormat = "image/png" | "application/pdf";

export interface LabelaryRenderParams {
  zpl: string;
  density?: LabelaryDensity;
  width?: number;
  height?: number;
  index?: number;
  responseFormat?: LabelaryResponseFormat;
}

export interface LabelaryRenderResult {
  buffer: Buffer;
  contentType: LabelaryResponseFormat;
}