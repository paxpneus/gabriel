# SupplierDiscountRule entity

`src/modules/inventory/supplier-discount-rules/`

- Scope: 4 pivot tables (`ruleBrands`/`ruleRims`/`ruleMeasures`/`ruleUnitBusinesses`). Empty axis = wildcard (matches anything), except `unit_business_ids` — can never be empty (validated at runtime in `createOrUpdate`, "loja não é um eixo curinga"). `resolveForItems`/`matchBatch` (`supplier-discount-rule.repository.ts`) is the matching engine that decides which order items get the discount — same matching reused read-only from Invoices, see `invoice/supplier-discount/filter.md`'s filter entry.

## `name` column (`m278`/`m279`)

Always computed by the backend — never accepted from the client. Built by `buildSupplierDiscountRuleName` (`helpers/build-name.ts`): includes ALL of quantity_step/discount/period + the 3 scope axes with a display name (brand/rim/unit business — `measure_ids` excluded, no name for it). Example: `"Dinâmica Promocional - A cada 2 Pneus - Marcas: Pirelli, Goodyear - Aros: 15, 16 - Lojas: Loja Centro - Desconto de 400 Reais - Entre 06/08/2026 e 08/08/2026"`.

- `%` for `PERCENTUAL`, `"Reais"` for `REAL`; `discount_value` (DECIMAL(14,2)) drops trailing zeros via `Number(...)` (`15.00`→`"15"`, `15.50`→`"15.5"`); dates `DD/MM/YYYY` in `America/Sao_Paulo` via `toTz()`.
- Empty axis (wildcard) shows `"Todas as marcas"`/`"Todos os aros"`/`"Todas as lojas"` instead of an empty segment.
- >3 selected values on an axis: lists first 3 (alphabetical) + `" +N"` for the rest (e.g. `"Marcas: Pirelli, Goodyear, Michelin +2"`) — never lists everything, keeps the name bounded.
- Unit business shows `number` when set, `name` otherwise (`UnitBusiness.number` nullable) — same "number ?? name" rule the service applies before calling the formatter (passes resolved `store_labels`, not raw rows; the helper itself stays a pure formatter with no `number`/`name` concept).
- Needs actual brand/rim/unit-business **names**, not just ids — `createOrUpdate` resolves via `brandService`/`rimService`/`unitBusinessService.findAll({where: {id: {[Op.in]: ids}}})` (service-to-service, per root CLAUDE.md layering) right before building `ruleFields`, in parallel via `Promise.all`.
- Recomputed on every create **and** update — the service requires the full field set on both (never a partial patch), so fresh scope-id lookups are always available.
- `m278` adds the column nullable; `m279` backfills existing rows with the identical formula in raw SQL (3 correlated subqueries, `ROW_NUMBER()`/`string_agg(...) FILTER (WHERE rn <= 3)` for axis-truncation, `COALESCE(NULLIF(number,''), name)` for the per-store label, double `regexp_replace` for trailing zeros) before tightening to `NOT NULL` — same split-migration shape as `m269`, just requested as two separate files instead of one combined.
