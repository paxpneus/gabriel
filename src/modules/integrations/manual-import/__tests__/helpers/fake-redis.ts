// Redis em memória com o subconjunto usado pelo manual-import (SET NX, MGET, pipeline, compare-and-* via EVAL).
export function createFakeRedis() {
  const store = new Map<string, string>();

  const client = {
    get: async (key: string) => store.get(key) ?? null,
    mget: async (...keys: string[]) => keys.map((key) => store.get(key) ?? null),
    set: async (key: string, value: string, ...args: unknown[]) => {
      if (args.includes("NX") && store.has(key)) return null;
      store.set(key, String(value));
      return "OK";
    },
    del: async (key: string) => (store.delete(key) ? 1 : 0),
    eval: async (
      script: string,
      _numKeys: number,
      key: string,
      expected: string,
      newValue?: string,
    ) => {
      const isDelete = script.includes('"DEL"');
      if (store.get(key) !== expected) return isDelete ? 0 : null;
      if (isDelete) {
        store.delete(key);
        return 1;
      }
      store.set(key, newValue!);
      return "OK";
    },
    pipeline: () => {
      const ops: Array<[string, string, ...unknown[]]> = [];
      const pipeline = {
        set: (key: string, value: string, ...args: unknown[]) => {
          ops.push([key, value, ...args]);
          return pipeline;
        },
        exec: async () => {
          for (const [key, value, ...args] of ops) await client.set(key, value, ...args);
          return [];
        },
      };
      return pipeline;
    },
  };

  return {
    store,
    client,
    get: async (key: string) => {
      const raw = store.get(key);
      if (raw == null) return null;
      try {
        return JSON.parse(raw);
      } catch {
        return raw;
      }
    },
    set: async (key: string, value: unknown) => {
      store.set(key, typeof value === "string" ? value : JSON.stringify(value));
      return "OK";
    },
    delete: async (key: string) => {
      store.delete(key);
    },
  };
}
