import UnitBusiness from "../../../../company/unit-business/unit-business.model";
import { getTCarIntegration } from "../../api/tecinco_api";

// Dados quase estáticos consultados por todo job de produto/nota; TTL evita
// uma query por job sem exigir restart quando a config muda.
const LOOKUP_TTL_MS = 5 * 60 * 1000;

type Entry<V> = { value: Promise<V>; expiresAt: number };

const integrationCache: { entry?: Entry<Awaited<ReturnType<typeof getTCarIntegration>>> } = {};
const unitBusinessCache = new Map<string, Entry<UnitBusiness | null>>();
const integrationsIdCache = new Map<string, Entry<string | null>>();

async function cached<V>(
  get: () => Entry<V> | undefined,
  set: (entry: Entry<V> | undefined) => void,
  load: () => Promise<V>,
  cacheable: (value: V) => boolean = () => true,
): Promise<V> {
  const current = get();
  if (current && current.expiresAt > Date.now()) return current.value;

  const value = load();
  set({ value, expiresAt: Date.now() + LOOKUP_TTL_MS });
  try {
    const resolved = await value;
    if (!cacheable(resolved)) set(undefined);
    return resolved;
  } catch (error) {
    set(undefined);
    throw error;
  }
}

export function getCachedTCarIntegration() {
  return cached(
    () => integrationCache.entry,
    (entry) => {
      integrationCache.entry = entry;
    },
    () => getTCarIntegration("Tecinco"),
  );
}

/** `number` no formato já padronizado da coluna (ex.: "12"). Null (não achou) nunca é cacheado. */
export function getCachedUnitBusinessByNumber(number: string) {
  return cached(
    () => unitBusinessCache.get(number),
    (entry) =>
      entry ? unitBusinessCache.set(number, entry) : unitBusinessCache.delete(number),
    () =>
      UnitBusiness.findOne({
        attributes: ["id", "number", "cnpj", "integrations_id"],
        where: { number },
      }),
    (value) => value !== null,
  );
}

export function getCachedIntegrationsIdForUnitBusiness(unitBusinessId: string) {
  return cached(
    () => integrationsIdCache.get(unitBusinessId),
    (entry) =>
      entry
        ? integrationsIdCache.set(unitBusinessId, entry)
        : integrationsIdCache.delete(unitBusinessId),
    async () =>
      (
        await UnitBusiness.findByPk(unitBusinessId, {
          attributes: ["integrations_id"],
        })
      )?.integrations_id ?? null,
    (value) => value !== null,
  );
}

export function clearTCarLookupCache() {
  integrationCache.entry = undefined;
  unitBusinessCache.clear();
  integrationsIdCache.clear();
}
