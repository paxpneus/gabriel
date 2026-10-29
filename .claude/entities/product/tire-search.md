# Auto busca de pneu

`GET /api/products/tire-search/get?mode=&measure=&load_index=&brand=&expedition_batch_id=` (`authenticate`) → `productService.searchTireCandidates`. Path com `/get` porque o `GET /:id` do `BaseController` é registrado antes e engoliria `/tire-search`.

- **Validação (controller, 400)**: `mode` obrigatório (`TireSearchMode.IN_BATCH`/`NORMAL`); `measure` obrigatória; `IN_BATCH` exige `expedition_batch_id`.
- **`IN_BATCH`** (bipe em lote de entrada/expedição): lote precisa ser da loja do usuário (`expeditionBatchService.findOne` por `id` + `unit_business_id`, senão service devolve null → 404); só produtos com `ExpeditionBatchItems.quantity_scanned < quantity` (`expeditionBatchItemsService.findPendingProductIds`). Nada pendente → `[]`.
- **`NORMAL`** (inventário/fora de lote): catálogo todo, `expedition_batch_id` ignorado.
- **Medida estrita no `name`** (sem `measure_id`/`rim_id` — muitos pneus não têm medida estruturada): `buildMeasureNameRegex` (`helpers/tire-search.ts`), mesma string no Postgres (`~*`) e no JS. Só espaço tolerado em volta dos separadores; bordas com lookaround barram dígito colado (`112.5/80-18`, `12.5/80-180`, `12.5/80-18.5`); sufixo de letra (`LT`) casa. `12.4/80-18` nunca casa `12.5/80-18`; `205/55R16` não casa `205/55-16`.
- **Repository** `findTireCandidates`: `type UNIT`, `category TIRE`, `is_active`, qualquer integração; flag `mapped_in_user_integration` via `productMappedToIntegrationLiteral` (`helpers/integration-mapping-filters.ts`); include `brandRegister`, `productConfigs`/`stocks` da loja do usuário.
- **Pontuação (só ordena, nunca exclui)**, no nome sem o trecho da medida:
  - índice: `buildTokenRegex(load_index)` — termo isolado à esquerda, sem dígito à direita (`R4` ≠ `R44`/`TR4`; `91` casa `91V`). `R-4` **não** casa `R4`.
  - marca: `brand_id` = `brandsService.findSimilarBrand(brand)` **ou** texto da marca no nome.
  - `score { matched, total }` (só opcionais passados); `ALTA` = todos, `IMPROVAVEL` = nenhum, `MEDIA` = meio-termo; só medida → `probability: null`. `matches.*` null quando o opcional não veio.
- **Ordem**: probabilidade → quem bateu o índice antes de quem bateu só a marca → nome.
- Item: `{ product, matches: { load_index, brand }, score, probability, mapped_in_user_integration }`. Mapear um candidato de outra integração cai nos `code` do DE x PARA (`physical-ean-owner.md`); na tela de não mapeados a flag é só aviso — quem decide é `createFromUnmapped` (`supplier-mapping.md`).

## Busca composta paginada

`GET /api/products/tire-search/paginated/get?mode=&measure=&load_index=&brand_id=&other_description=&expedition_batch_id=&page=&perPage=` (`authenticate`, `userPermissions`) → `productService.paginateTireCandidates`. Rota própria, só busca composta; o `index` (search livre) não muda.

- **Validação (controller, 400)**: `mode`, `measure` obrigatórios; `load_index`, `brand_id` (uuid se vier), `other_description` (coringa) opcionais; `IN_BATCH` exige `expedition_batch_id` (lote de outra loja → 404). Escopo de estoque/config = loja do usuário (`stockUnit` como no `index`, filtro `stockUnit` opcional).
- **Mesma lógica da auto busca**, mas marca **só por `brand_id`** (sem `findSimilarBrand`/texto no nome). Filtro (UNIT/TIRE/ativo/medida estrita/itens pendentes do lote) e pontuação no SQL: `repository.paginateTireCandidates` → `paginateWithStock` com colunas calculadas `load_index_match` (`buildTokenRegex(...).source` em `~*` sobre `regexp_replace(name, medida)`), `brand_match`, `other_description_match` (`name ILIKE %texto%`, `%`/`_`/`\` escapados), `mapped_in_user_integration` e `ORDER BY` (soma dos matches → índice → nome), sobrepondo o `sortBy`. Opcional não enviado vira `FALSE` na coluna e **fica fora do `ORDER BY`** (Postgres recusa `ORDER BY FALSE`: "non-integer constant").
- **Resposta**: `{ data: TireSearchCandidate[], meta }` — item igual ao da auto busca, `product` com os includes do paginate (stocks, brandRegister, rimRegister, measureRegister, productConfigs). Mesma regra de `matches`/`score`/`probability` do §1: opcional não enviado → `null` e fora do `total`; só medida → `probability: null`.
