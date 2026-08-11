// src/__tests__/setup.ts
// Carregado antes de cada suite via jest.config.ts > setupFiles

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";
process.env.XML_ENCRYPTION_KEY =
  process.env.XML_ENCRYPTION_KEY ||
  "0116d9c244b5b7bac89ba7ecb0c7fd31255b233a6d8950324e57e0d44b53b810";  // 32 bytes hex, valor de teste
jest.mock("uuid", () => ({
  v4: () => "mock-uuid",
}));