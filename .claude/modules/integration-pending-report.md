# Relatório de pendências de integração

`GET /supplier-mapping/integration-pending/get?section=` → `supplierMappingService.getIntegrationPendingReport(integrationsId, section)`. Só admin/developer (403), integração do usuário logado, **sem paginação** (array completo), só leitura.

Fontes do "o que o ERP diz" (só leitura, nunca usadas em resolução): `product_configs.gtin_erp` (mapping principal, por loja) + `integration_mappings.erp_data->>'ean'` (mappings não principais). Agrupado por `eanZeroInsensitiveKey`. Linhas trazem `integration { id, name }`, **nunca lojas**: o cadastro do ERP é da integração, igual em todas as lojas dela (lojas só filtram a query).

Seções (`INTEGRATION_PENDING_SECTIONS`):
- `overrides` — cada DE x PARA `is_physical_override` cujo EAN o ERP ainda manda pra outros produtos: `ean`, `owner`, `defined_by` (último autor em `audit_logs`), `replaced` (produtos/origens/integração). Override sem substituído não aparece.
- `erp_duplicates` — mesmo EAN (ignorando zero) em 2+ produtos no ERP, com `prevailing.rule`: `PHYSICAL_OVERRIDE` → `LOCAL_GTIN` (gtin local igual) → `SUPPLIER_MAPPING` → `NONE` (omitido em todos).
- `missing_ean` — produto com configuração numa loja da integração e `gtin_erp` vazio, uma linha por produto.
- `unmapped` — `unmappedInvoiceProductService.findPendingByIntegration`.

`gtin_erp` só fica completo depois de sync completo (full run Tecinco, populate `/api/bling-sync` no Bling).
