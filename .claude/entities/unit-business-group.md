# UnitBusinessGroup / UnitBusinessGroupMember

Agrupamento N:N de unit businesses (uma loja pode estar em vários grupos; um grupo tem várias lojas).

## Schema (migration `m312-create-unit-business-groups.js`)
- `unit_business_groups`: `id`, `name` (unique), `description` (nullable).
- `unit_business_group_members` (pivot): `unit_business_group_id`, `unit_business_id`.
  - FKs `ON DELETE CASCADE` dos dois lados — apagar grupo ou loja remove o vínculo.
  - Unique `(unit_business_group_id, unit_business_id)`; índice extra em `unit_business_id`.

## Código
- `src/modules/company/unit-business-groups/{unit-business-group,unit-business-group-member}/` — CRUD padrão Base*.
- Fica fora de `unit-business/` porque `config/routes.ts` não recursa em subpasta de pasta que já tem `.routes.ts`.
- Rotas: `/api/unit-business-group`, `/api/unit-business-group-member`.
- `GET /unit-business-group/:id` sobrescreve o `show` base → `repository.getFullById` (inclui `unitBusinesses` {id, number, name} + `UnitBusinessGroupMember.id` do vínculo, pra o front apagar).
- `GET /unit-business` (index paginado) inclui `groups` [{id, name}] via `unitBusinessRepository.findPaginatedWithGroups` — `distinct: true` obrigatório (join N:N infla o count). Sem `sortBy`, ordem padrão = `helpers/list-order.ts` (`onlineFirstThenNumberOrder`: ONLINE por nome, depois físicas por `number` numérico). A resposta também traz `groups` no topo (todos os grupos, {id, name}, por nome) via `unitBusinessGroupService.findAll`.
- Permissão: children de `unit_businesses` em `ROLE_PERMISSIONS` (herdam a permissão de Unidades de Negócio).
- Associações: `UnitBusinessGroup.members` / `.unitBusinesses` (belongsToMany), `UnitBusiness.groupMemberships` / `.groups`, `UnitBusinessGroupMember.group` / `.unitBusiness`.
