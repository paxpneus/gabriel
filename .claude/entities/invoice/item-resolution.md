# Invoice item → product resolution

Standard product-resolution order used across the Bling queue, NF-e XML import, and maintenance scripts: `ProductConfig.sku` first → `ProductConfig.gtin` → `SupplierMapping` by code + integration. SKU wins when it matches; EAN/gtin is only a fallback when there's no SKU match. `gtin_package` does **not** participate (removed in `m265`, see `../product/index.md`).

`src/shared/utils/xml/invoice-xml.ts` parses NF-e XML and resolves each item's product using that same order.

## Fixed — duplicate-key crash in `addMissingInvoiceItems`

`invoice.service.ts`'s reprocess path (used when an NF-e's `existingInvoice` is found in `invoice-xml.ts`) only checked `InvoiceItems` to decide which incoming `product_id`s were "already handled," then inserted `InvoiceFiscalItem` unconditionally for the rest. Both tables share the identical `UNIQUE(invoice_id, product_id)` constraint (`invoice_items` via `uq_invoice_items_invoice_product`, `invoice_fiscal_items` via `invoice_fiscal_items_invoice_id_product_id_unique`), and it's an accepted, designed scenario (see `../product/tecinco/automap-cascade.md`) for two different Tecinco `epctb_codigo`s to resolve to the same local `Product` — so a `product_id` could already have an `InvoiceFiscalItem` row (e.g. from an earlier pass that committed, then failed/retried for an unrelated reason) without yet having an `InvoiceItems` row for this exact call's input set, and the old check let it through to a raw Postgres constraint error instead of skipping it. **Fixed** by checking **both** `InvoiceItems` and `InvoiceFiscalItem` for existing `(invoice_id, product_id)` pairs before filtering. If touched again: keep both checks — checking only one table is the exact bug that was fixed.

## Manual mapping cascade

`POST /add/item` → `InvoiceItemsService.createInvoiceItemForUnmappedProductsInTx`: mapping one `UnmappedInvoiceProduct` manually also auto-maps "sibling" unmapped rows in *other* invoices sharing the same supplier code + sender CNPJ (`cascadeAutoMapUnmapped`/`findCascadeMatches`). `cascadeAutoMapUnmapped` runs **once per request only**, from the root call — fetches all siblings in one query, processes each via `createInvoiceItemForUnmappedProductsInTx(..., triggerCascade: false)`. `triggerCascade` defaults `true`, must stay `true` only on the root (user-initiated) call.

Fixed from a self-recursive design (every sibling re-ran `cascadeAutoMapUnmapped` itself): since the outer loop's match list was captured once up front, a sibling further down could already have been consumed by an inner recursive call from an earlier sibling, and the outer loop's stale second attempt threw `"Produto não mapeado não encontrado!"` on the already-deleted row — rolling back the whole shared transaction, undoing siblings that had already mapped successfully. If touched again: keep `cascadeAutoMapUnmapped` single-shot (`triggerCascade: false` on every call it makes), don't reintroduce recursion.

## Raw-XML unmapped fallback removed

When the calling integration provides *no* item info at all (`operationalItems` and `unmappedItems` both empty — tracked by `willFallbackToXmlDet`), the code used to fall back to parsing the raw XML `<det>` nodes and create an `UnmappedInvoiceProduct` per line with a generic reason. This produced unmapped rows for lines with no way to know if they were even a tracked product category (real example: an engine oil line got flagged even though only tire-category invoices should reach this reconciliation) — `cProd` in that fallback is the *supplier's* code, never resolves a `Product`, and there's no category signal available at that point.

Now, when `willFallbackToXmlDet` is true, the **entire invoice is ignored** for unmapped-reconciliation this pass: no unmapped rows created, and the existing "delete stale `UNMAPPED` rows no longer present this pass" loop is also skipped — nothing already recorded for that invoice gets touched. The invoice itself still gets created/updated normally with whatever real items *were* resolved; only unmapped-tracking is skipped.
