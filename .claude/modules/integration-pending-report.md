# Relatório de pendências de integração

`GET /supplier-mapping/integration-pending/get?section=` → `supplierMappingService.getIntegrationPendingReport(integrationsId, section)`. Só admin/developer (403), integração do usuário logado, **sem paginação** (array completo), só leitura.

Fonte do "o que o ERP diz" em `overrides`/`erp_ean_duplicates`/`erp_sku_duplicates`/`missing_ean`: `integration_mappings.erp_data->>'ean'|'sku'` de **todos** os mappings PRODUCT (principal → `ERP_PRIMARY`, não principal → `ERP_NON_PRIMARY`) via `integrationMappingService.findErpCodesInIntegration(id, field)` — não `product_configs.gtin_erp`/`sku_erp`, que só têm o código principal. Cada produto traz `external_ids` (códigos no ERP que mandam o valor). Agrupado por `eanZeroInsensitiveKey`. Linhas trazem `integration { id, name }`, **nunca lojas**: o cadastro do ERP é da integração, igual em todas as lojas dela (lojas só filtram a query).

Seções (`INTEGRATION_PENDING_SECTIONS`):
- `overrides` — cada DE x PARA `is_physical_override` cujo EAN o ERP ainda manda pra outros produtos: `ean`, `owner`, `defined_by` (último autor em `audit_logs`), `replaced` (produtos/origens/integração). Override sem substituído não aparece.
- `erp_duplicates` — produto com 2+ mappings PRODUCT na integração (cadastro duplicado no ERP): `{ product_id, product_name, codes[{ external_id, is_primary, erp_data{name,ean,sku}|null }], integration }`, por nome. `integrationMappingService.findProductsWithMultipleCodes` → repository `findProductMappingsWithMultipleCodes` (`GROUP BY internal_id HAVING COUNT(*) > 1` no banco, lê só nome/EAN/SKU do JSONB).
- `erp_ean_duplicates` — mesmo EAN (ignorando zero) em 2+ produtos no ERP, com `prevailing.rule`: `PHYSICAL_OVERRIDE` → `LOCAL_GTIN` (gtin local igual) → `SUPPLIER_MAPPING` → `NONE` (omitido em todos).
- `erp_sku_duplicates` — mesmo SKU (exato) em 2+ produtos: `{ sku, products[] }` (produto sem `eans`), sem regra de quem prevalece.
- `missing_ean` — código com `erp_data` presente e sem `ean` (`findErpCodesInIntegration(id, "ean", true)`; `erp_data` nulo = não sincronizado, fora), uma linha por produto (sem `eans`), ordenado por nome.
- `unmapped` — `unmappedInvoiceProductService.findPendingByIntegration`.

`erp_data` só fica completo depois de sync completo (full run Tecinco, populate `/api/bling-sync` no Bling).
