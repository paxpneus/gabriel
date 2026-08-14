// src/__tests__/setup.ts
// Carregado antes de cada suite via jest.config.ts > setupFiles

import fs from "fs";
import path from "path";
import { createModelMock } from "../shared/utils/test-utils/auto-mock-model";

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";
process.env.XML_ENCRYPTION_KEY =
  process.env.XML_ENCRYPTION_KEY ||
  "0116d9c244b5b7bac89ba7ecb0c7fd31255b233a6d8950324e57e0d44b53b810";  // 32 bytes hex, valor de teste
jest.mock("uuid", () => ({
  v4: () => "mock-uuid",
}));

// ─── Auto-mock de todos os *.model.ts do projeto ──────────────────────────
// Evita ter que escrever jest.mock(".../algo.model", () => ({...})) em
// cada arquivo de teste. Qualquer método chamado nesses models
// (findAll, findOne, create, etc.) vira jest.fn() automaticamente.



const SRC_ROOT = path.join(__dirname, "..");
const IGNORED_DIRS = new Set(["__tests__", "__mocks__", "node_modules"]);

function findModelFiles(dir: string): string[] {
  let results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results = results.concat(findModelFiles(fullPath));
    } else if (/\.model\.ts$/.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

for (const modelPath of findModelFiles(SRC_ROOT)) {
  jest.mock(modelPath, () => ({
    __esModule: true,
    default: createModelMock(),
  }));
}