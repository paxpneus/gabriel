# UnmappedEntity (`unmapped_entities`)

`src/modules/integrations/unmapped-entities/` (nível 1). Pendência genérica: valor que a integração mandou e ainda não tem `integration_mapping`. Produto NÃO usa (tem `unmapped_invoice_products`, lógica própria).

## Schema (`m340`)
- `entity` (STRING(50), validado contra `ENTITY_TYPES` de integration-mapping — mesmo vocabulário de `integration_mappings.entity_type`; string pra entidade nova não exigir ALTER TYPE), `external_id`, `integrations_id` (FK CASCADE), `description` (nome na integração, ex.: "Rede - Crédito Master 2x").
- Unique `(entity, integrations_id, external_id)`. Sem `internal_id`: a pendência some ao ser mapeada.

## Escrita
- Só pelo sync: `registerMany(entity, integrationsId, items)` — `bulkCreate` com `updateOnDuplicate` (repetido só atualiza `description`).
- `removeMany(entity, integrationsId, externalIds)` — chamado por `resolveBlingPaymentMethods` depois de auto-mapear: código que estava pendente e passou a ter tipo coberto sai da lista.
- Único produtor hoje: `resolveBlingPaymentMethods` (forma Bling cujo `tipoPagamento` nenhum `payment_methods` cobre; o pagamento cai em "Outros" até mapear).

## Rotas (`/api/unmapped-entities`)
- `GET /` (filtros `entity`, `integrations_id`, `external_id`; busca `description`/`external_id`), `GET /:id`.
- `POST /:id/map` body `{ internal_id }` (uuid) → `integrationMappingService.createForExistingEntity` (checa a entidade, erro se código já mapeado pra outro) + apaga a pendência + audita (`helpers/audit.ts`, entrada `INTEGRATION_MAPPING` CREATE), numa transação. 201 com o mapping, 404 sem pendência, 400 erro. Usuário logado precisa de acesso à integração (`assertIntegrationAccess`).
- CRUD genérico de escrita → 405.
- Permissão: filho `unmapped_entities` de "Integrações" em `ROLE_PERMISSIONS`.
- Mapear não regrava o que já foi importado com "Outros" (pedido só muda reimportando).
