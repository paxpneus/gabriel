// src/__tests__/setup.ts
// Carregado antes de cada suite via jest.config.ts > setupFiles

process.env.JWT_SECRET = "test-secret";
process.env.NODE_ENV = "test";
jest.mock("uuid", () => ({
  v4: () => "mock-uuid",
}));