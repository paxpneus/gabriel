import path from "path";

// "config" fica um nível abaixo tanto de src/ (dev, tsx roda direto da
// fonte) quanto de dist/ (produção, compilado por tsc) — por isso os mesmos
// dois ".." alcançam a raiz do projeto nos dois casos, sem depender de
// process.cwd() (que pode divergir conforme quem sobe o processo).
const PROJECT_ROOT = path.resolve(__dirname, "..", "..");

// .traineddata do Tesseract baixado uma única vez e versionado localmente
// (ver .claude/modules/ai-vision-extraction.md) — nunca buscado de CDN em
// runtime.
export const TESSDATA_DIR = path.join(PROJECT_ROOT, "resources", "tessdata");
