# Product entity

`Product` + `ProductConfig` + `SupplierMapping` resolved as one system — a physical product's identity spans all three. Split by subject:

- `core.md` — Product model: tenant-scoping, code lookup, query config, routes, category enum, FK-on-delete, external-id resolution
- `config.md` — ProductConfig schema, `gtin_erp` (read-only), gtin_package removal
- `supplier-mapping.md` — SupplierMapping schema, triggers, createFromUnmapped
- `tecinco/automap-cascade.md` — SKU/SupplierMapping auto-map fallback (Bling + Tecinco)
- `tecinco/catalog-preflight.md` — Tecinco catalog-duplicate detection before enqueue
- `tecinco/duplicate-protection.md` — skuOmitted/eanOmitted write protection, DB triggers, manual create/map on a duplicate
- `bling/deactivation.md` — Bling situacao=E deactivation flow
- `physical-ean-owner.md` — "Confirmar EAN físico" (`is_physical_override`), EAN validation per integration with leading zeros, error codes
- `tire-search.md` — tire auto search (strict measure in name, load index/brand scoring, IN_BATCH vs NORMAL)
- `merge-duplicate.md` — manual SQL runbook to replace a duplicate product (OLD → NEW) in every table and delete OLD
