import { labelaryApi } from "./api/labelary_api";
import {
  LabelaryRenderParams,
  LabelaryRenderResult,
} from "./labelary.types";

const DEFAULT_DENSITY = "8dpmm";
const DEFAULT_WIDTH = 4;
const DEFAULT_HEIGHT = 6;
const DEFAULT_INDEX = 0;
const DEFAULT_FORMAT = "image/png";

const render = async (
  params: LabelaryRenderParams,
): Promise<LabelaryRenderResult> => {
  const {
    zpl,
    density = DEFAULT_DENSITY,
    width = DEFAULT_WIDTH,
    height = DEFAULT_HEIGHT,
    index = DEFAULT_INDEX,
    responseFormat = DEFAULT_FORMAT,
  } = params;

  if (!zpl) {
    throw new Error("[LabelaryService] Código ZPL é obrigatório");
  }

  const { data } = await labelaryApi.post<ArrayBuffer>(
    `/v1/printers/${density}/labels/${width}x${height}/${index}/`,
    zpl,
    {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: responseFormat,
      },
      responseType: "arraybuffer",
    },
  );

  return {
    buffer: Buffer.from(data),
    contentType: responseFormat,
  };
};

export default { render };