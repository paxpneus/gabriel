export type LabelaryErrorCode =
  | "ZPL_REQUIRED"
  | "LABEL_TOO_LARGE"
  | "TOO_MANY_LABELS"
  | "RATE_LIMITED"
  | "IMAGE_BUFFER_TOO_LARGE"
  | "EMBEDDED_OBJECT_TOO_LARGE"
  | "FONT_TOO_LARGE"
  | "INVALID_REQUEST"
  | "UNKNOWN";

export interface ClassifiedLabelaryError {
  code: LabelaryErrorCode;
  message: string;
  rawMessage: string;
  status: number;
}

const ERROR_MATCHERS: { code: LabelaryErrorCode; test: (msg: string) => boolean }[] = [
  { code: "LABEL_TOO_LARGE", test: (m) => /label.*(width|height|size).*(large|exceed)/i.test(m) },
  { code: "IMAGE_BUFFER_TOO_LARGE", test: (m) => /buffer/i.test(m) && /large/i.test(m) },
  { code: "EMBEDDED_OBJECT_TOO_LARGE", test: (m) => /embedded (object|image)/i.test(m) },
  { code: "FONT_TOO_LARGE", test: (m) => /font file/i.test(m) },
];

const FRIENDLY_MESSAGES: Record<LabelaryErrorCode, string> = {
  ZPL_REQUIRED: "Informe o código ZPL antes de renderizar.",
  LABEL_TOO_LARGE: "O tamanho da etiqueta é muito grande (máximo 15 x 15 polegadas).",
  TOO_MANY_LABELS: "Muitas etiquetas nessa requisição (máximo 50).",
  RATE_LIMITED: "Muitas requisições em pouco tempo. Aguarde um instante e tente novamente.",
  IMAGE_BUFFER_TOO_LARGE: "A imagem gerada é muito grande para ser processada.",
  EMBEDDED_OBJECT_TOO_LARGE: "Uma imagem/objeto embutido no ZPL é muito grande.",
  FONT_TOO_LARGE: "A fonte enviada é muito grande.",
  INVALID_REQUEST: "O código ZPL enviado é inválido. Verifique a sintaxe.",
  UNKNOWN: "Não foi possível renderizar a etiqueta.",
};

const classifyCode = (status: number, rawMessage: string): LabelaryErrorCode => {
  if (status === 429) return "RATE_LIMITED";
  if (status === 413) return "TOO_MANY_LABELS";

  if (status === 400) {
    const matched = ERROR_MATCHERS.find((m) => m.test(rawMessage));
    return matched?.code ?? "INVALID_REQUEST";
  }

  return "UNKNOWN";
};

export const classifyLabelaryError = (
  status: number,
  rawMessage: string,
): ClassifiedLabelaryError => {
  const trimmed = rawMessage?.trim() || "";
  const code = classifyCode(status, trimmed);

  return {
    code,
    message: FRIENDLY_MESSAGES[code],
    rawMessage: trimmed,
    status,
  };
};