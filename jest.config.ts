import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  // tests/ = entidade no nível 2 (testes dentro do domínio, ver "Organização de módulos" no CLAUDE.md).
  testMatch: ["**/__tests__/**/*.test.ts", "**/__tests__/**/*.spec.ts", "**/tests/**/*.test.ts", "**/tests/**/*.spec.ts"],
  testPathIgnorePatterns: ["/node_modules/", "setup\\.ts$"],

  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: "<rootDir>/tsconfig.json",
      },
    ],
  },
  moduleNameMapper: {
    "^(.*)config/sequelize$": "<rootDir>/src/config/sequelize.test.ts",
  },
  setupFiles: ["<rootDir>/src/__tests__/setup.ts"],
  clearMocks: true,
  restoreMocks: true,
};

export default config;