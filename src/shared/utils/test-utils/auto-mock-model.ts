// src/shared/test-helpers/auto-mock-model.ts
export function createModelMock(overrides: Record<string, unknown> = {}) {
  const cache: Record<string, unknown> = { ...overrides };

  return new Proxy(cache, {
    get: (target, prop) => {
      if (prop === "then" || typeof prop === "symbol") return undefined;
      if (!(prop in target)) {
        target[prop as string] = jest.fn();
      }
      return target[prop as string];
    },
  });
}