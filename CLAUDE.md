# Git

**Nunca commitar sozinho.** `git commit` só quando o usuário pedir explicitamente naquele turno — mesmo depois de terminar uma tarefa grande, corrigir bug, ou aplicar fix que o usuário claramente vai querer versionado. Terminar o código não é permissão pra commitar; perguntar/avisar que está pronto pra commit, sim.

**Avisar pra commitar em blocos pequenos.** Terminou um bloco de mudança de uma responsabilidade só e a próxima tarefa vai mexer em outra responsabilidade → avisar o usuário pra commitar antes de seguir (com a sugestão de mensagem abaixo), em vez de acumular várias responsabilidades num commit só. Só avisa — quem commita é o usuário (regra acima).

**Sugestão de mensagem de commit — só quando o usuário pedir** (ex.: "levantamento das alterações do commit"): uma linha no padrão dos commits do repo, `TIPO: Descrição` — tipo em maiúsculo (`FEAT`, `FIX`, `REFACTOR`), descrição em inglês, começando com maiúscula, resumindo o conjunto da mudança. Ex.: `FIX: Close leading-zero EAN ambiguity on all write flows and zero-aware expedition scan`. Entregar num bloco de código pronto pra copiar.

# Testes

**Nunca `npm run test`/`npx jest` sozinho (sem flag).** Rodar a suite inteira em paralelo (workers default do Jest) consome memória demais e derruba o VS Code. Sempre `--runInBand` (ex.: `npx jest --runInBand`, ou escopado num arquivo/pasta com `--runInBand` também) — mesmo rodando só um subconjunto de arquivos.

# Architecture rules

## Simplicidade

- Escreva o código mais simples que resolve o pedido. Não antecipe necessidades futuras.
- Não crie helper, função, classe, tipo, middleware ou arquivo novo para algo usado em um único lugar. Deixe inline.
- Só extraia uma abstração quando a mesma lógica se repetir em 3 ou mais lugares, ou quando eu pedir.
- Siga os padrões existentes (controller → service → repository, BaseController/CRUD genérico). Não crie novas camadas.
- Antes de criar um arquivo novo, veja se o código cabe num arquivo existente do módulo.
- Ao simplificar, não mude comportamento: rotas, status HTTP, formato de resposta, mensagens de erro e validações.
- Se uma abstração parecer necessária, pergunte antes de criar.

- **Audit log sempre pelo helper.** Montagem do audit (`changes`/`affected`) nunca inline na função de negócio. Genérico: `buildAuditEntries` (`global/audit-logs/helpers/audit-change.ts`) recebe as linhas mexidas (before lido e travado com `lock: t.LOCK.UPDATE` antes de alterar, after como ficou no banco — nunca o que se pretendia gravar) + `fields` + mensagem. Cada módulo tem o seu em `<módulo>/helpers/audit.ts`, só com o específico (mensagem pra leigo, fields, label); a função só chama `auditLogService.record(<helperDoModulo>(...), t)`. Referência: `inventory/products/helpers/audit.ts` (`productRetiredFromIntegrationAudit`). Exceção à regra de "não criar função pra uso único" acima.

## Schemas de validação (Zod)

Schema Zod fica em `<entidade>/schemas/<entidade>.schema.ts` — nunca em `src/shared/`, sem index central. Quem reaproveita campos de outra entidade importa direto do `schemas/` dela (ex.: `contacts/schemas/contact.schema.ts` usa `RequiredUserFields`/`phoneField` de `company/users/users/schemas/user.schema.ts`).

## Layer separation: repository / service / controller

Segue `BaseRepository`/`BaseService`/`BaseController` (`src/shared/utils/base-models/`). Cada camada só fala com a mesma camada de outras entidades — nunca pula pra camada de baixo.

- **Repository**: só a própria model Sequelize. Precisa de dado de outra entidade fora de um `include`? Chama a **repository** dela — nunca a model direto.
- **Service**: regra de negócio/orquestração. Precisa de outra entidade? Chama o **service** dela (`productConfigService`, `supplierMappingService`) — nunca model/repository direto, nem leitura.
- **Controller**: só request/response (params, auth context, status code); delega pro próprio service.

`include` (eager-load numa query) é permitido só na camada **repository**, quando a query já é da própria model — não conta como "chamar outra entidade", é join. Query separada contra outra model (`ProductConfig.findOne()` dentro de `ProductService`) é violação, mesmo só leitura.

**Esse carve-out do `include` é só pra repository — não pra service.** Mesmo dentro da própria entidade, nenhuma query na service pode referenciar outra model — nem um `include` simples de eager-load. Isso vira método nomeado na repository da entidade (ex: `unmappedInvoiceProductRepository.findUnmappedByInvoiceIds`, `findByCodeExcluding`), e a service só chama o método — nunca monta `include`/`where` ela mesma. Exceção: `BaseService.findAll`/`findOne` com `where` simples, sem `include`, direto na service — ok, não referencia outra model. Padrão de referência: `unmapped-invoice-product.repository.ts` (`getFullById`, `findUnmappedByInvoiceIds`, `findByCodeExcluding`) + `unmapped-invoice-product.service.ts`'s `findCascadeMatches` (repository monta a query, service só filtra CNPJ normalizado).

Antes de criar método pra buscar dado de outra entidade: checar `BaseRepository`/`BaseService`/`BaseController` primeiro — geralmente já existe `findOne`/`findById`/`findAll` genérico; a solução costuma ser chamar `<entity>Service.findOne(...)`, não escrever query nova.

Exceção (ver "Organização de módulos"): entidade principal → sub-entidade do **mesmo módulo** usa a repository da sub-entidade. Entidade de outro módulo continua pelo service dela.

## Organização de módulos

**Escopo: vale pra código novo e pra entidade que eu pedir pra refatorar.** Módulo/entidade que já existe fica como está — mexer nele por outra tarefa não é motivo pra reorganizar as pastas. Referência de nível 2 já aplicada: `sales/contacts/`.

### Conceitos
- Entidade: uma tabela (order, order_items, invoice...).
- Módulo: agrupamento de entidades relacionadas (`sales/orders/` contém order, order_items, order_history, order_payment).
- Domínio: uma responsabilidade DENTRO de uma entidade que cresceu (ingestão, cancelamento, relatórios...). Não dividir por variação de dado (entrada/saída, tipo, status): isso é filtro, não domínio.

### Dois níveis: o padrão é o plano
- Nível 1 (PADRÃO pra toda entidade): pasta plana.
    ```
    <entidade>/
      <entidade>.model.ts
      <entidade>.repository.ts
      <entidade>.service.ts
      <entidade>.controller.ts
      <entidade>.types.ts
      <entidade>.routes.ts
    ```
- Nível 2 (por domínios, abaixo): só pra ENTIDADE que cresceu.
- Promover pro nível 2 quando houver pelo menos um destes:
  - service com mais de ~400 linhas;
  - dois ou mais grupos de métodos que mudam por motivos diferentes;
  - dificuldade recorrente de achar onde algo está.
- Promover = mover os arquivos atuais pra `core/` e extrair os domínios. Nunca criar a estrutura de nível 2 numa entidade nova.
- Na dúvida, fica no nível 1.

### Entidades dentro de um módulo
- Num mesmo módulo, entidades em níveis diferentes convivem:
    ```
    orders/
      order/           nível 2 (muitas funções)
      order_items/     nível 1
      order_history/   nível 1
      order_payment/   nível 1
    ```
- Fluxos da entidade principal que envolvem sub-entidades (criar pedido com itens, registrar histórico) ficam na entidade principal e usam as repositories das sub-entidades. Sub-entidades guardam só o próprio CRUD e regras que dizem respeito só a elas.
- Dependência entre entidades do módulo é de mão única: principal → sub-entidades. Sub-entidade nunca importa a principal; se precisar, a lógica pertence à principal.
- Cada sub-entidade é promovida ao nível 2 sozinha, se crescer.

### Nível 2: estrutura da entidade
```
<entidade>/
  <entidade>.model.ts     model da entidade
  <entidade>.types.ts     tipos usados por vários domínios
  <entidade>.routes.ts    agrega os routers dos domínios (URLs não mudam)
  index.ts                API pública pro resto do projeto
  shared/                 o que 2+ domínios da entidade usam
  core/                   CRUD, listagens e detalhe
  <dominio>/              um por responsabilidade
```
`.model.ts` e `.routes.ts` ficam obrigatoriamente na raiz da entidade: o loader de `config/routes.ts` só procura neles ali (e não desce em pasta que tem `.routes`).

### Nível 2: estrutura de cada domínio (e de `core/` e `shared/`)
```
<dominio>/
  index.ts                fachada: única porta de entrada do domínio
  controllers/
  services/
    <dominio>.service.ts  orquestra e delega pras operações
    <subdominio>/         uma pasta por subdomínio, um arquivo por operação
  repositories/
  types/
  helpers/
  tests/
```
- A raiz de um domínio tem SÓ pastas de camada e o `index.ts`. Nenhum arquivo solto.
- Só se criam as pastas de camada que o domínio usa (sem `controllers/` vazio se o domínio não tem rota).
- Subdomínios existem dentro de `services/` (onde as operações vivem). Controllers, repositories e helpers ficam no nível do domínio.

### Regras do nível 2
1. Uma pasta = um motivo de mudança.
2. Ancestral comum mais próximo: helper, type, repository ou constante mora no nível mais próximo que contém TODOS os seus usuários.
   - usado por uma só operação → função privada no próprio arquivo
   - usado só dentro de um subdomínio → na pasta do subdomínio
   - usado por 2+ subdomínios ou camadas do domínio → `<dominio>/helpers/`
   - usado por 2+ domínios da entidade → `<entidade>/shared/`
   - usado por outro módulo → exportado pelo `index.ts` da entidade (se for regra da entidade) ou `src/shared/` global (se for genérico)
   Se o uso mudar, o arquivo sobe ou desce de nível. (Mesma ideia da seção "Helpers de query/filtro reutilizáveis": no nível 2, `helpers/` é o do domínio ou o `shared/` da entidade.)
3. Fachada: de fora de um domínio, importa-se só o `index.ts` dele, nunca arquivo interno. Outros módulos importam só do `index.ts` da entidade. Exceções (por import circular, ver abaixo): model, types e controllers.
4. Domínios irmãos de uma mesma entidade nunca se importam; o que compartilham sobe pro `shared/` da entidade. (Vale entre domínios, não entre entidades do módulo.) Objetivo: zero import circular.
5. Services dependem de repositories, não de services de outro domínio da mesma entidade. Orquestração fica no service de quem inicia o fluxo.
6. Criar subdomínios em `services/` só quando houver mais de ~6 arquivos, um service com mais de ~300 linhas, ou grupos claramente distintos de operações.

### Fachadas e import circular (ajustes deste projeto)
- **`index.ts` nunca exporta controller.** Controller importa `user-permissions` → `config/routes.ts`, que carrega todas as rotas no import: controller numa fachada faz qualquer service (inclusive em worker) puxar a camada HTTP inteira. Só o `<entidade>.routes.ts` importa `<dominio>/controllers/*.controller.ts` direto.
- **Model e types são importados direto** (`<entidade>.model.ts`/`.types.ts`), não pela fachada: são folhas sem dependência e são importados por `sequelize-associations` e por repositories de outras entidades; via `index.ts` puxariam os services e fechariam ciclo (ex.: `user.repository` → contacts → sellers.service → `user.service` → `user.repository`).
- **Types seguem o ancestral comum**: tipo de um domínio só vai pra `<dominio>/types/<dominio>.types.ts`; `<entidade>.types.ts` fica com o que é da entidade toda (atributos do model, enums) e com constantes usadas por outros módulos. Se o `<entidade>.types.ts` precisar de um tipo de domínio, usa `import type` do `index.ts` do domínio (apagado no build, sem ciclo). Ex.: `ContactCustomData` (raiz) usa `ManagerPeriod` de `contacts/sellers`.
- **Se o `index.ts` da entidade fechar ciclo, importar o `index.ts` do domínio** (nunca arquivo interno), com comentário dizendo o porquê. Ex.: `integration-mapping/helpers/map-repository.ts` importa `sales/contacts/core` (a fachada da entidade puxa sellers → `integration-mapping.service` → o próprio mapa).
- Fachada reexporta com `export { default as x } from` (getter lazy); quem consome usa o valor dentro de método, nunca no carregamento do módulo.
- Fachada carrega todos os services da entidade: teste de outro módulo que importa a fachada sem precisar dela real faz `jest.mock` da fachada (senão a cadeia abre Redis/BullMQ e o Jest não sai). Ex.: `seller-commission-report.service.test.ts` mocka `sales/contacts`.

### Contra overengineering
- Não criar pasta vazia nem "para o futuro".
- Domínio com 2-3 métodos simples fica dentro do core.
- Não criar interface ou abstração pra algo com uma só implementação.
- Sem container de DI: dependências como parâmetro default do construtor e export default de instância (padrão atual do projeto).
- Refatoração estrutural nunca muda comportamento. Mudança de regra ou limpeza de código é commit separado.

### Testes
- Nível 1: em `__tests__/` ao lado da entidade (padrão atual).
- Nível 2: em `tests/` dentro do domínio que testam, espelhando `services/` (`jest.config.ts` já casa `**/tests/**/*.test.ts`).

## Helpers de query/filtro reutilizáveis

Lógica de query (fragmento `where`, `Sequelize.literal`, etc.) não-trivial e reutilizável por mais de um filtro/método: função nomeada, exportada, parametrizada em `helpers/` da própria entidade (ex: `invoice/helpers/`) — nunca função solta/closure dentro do service/repository. Parametrizar pelo que varia entre chamadas (nome de loja, unit business id, alias de tabela, data de referência), não hardcoded pro primeiro caso de uso. Referência: `invoice/helpers/totals.ts` (`totalExpectedLiteral`/`totalReadLiteral`), `invoice/helpers/custom-filters.ts` (`storeCollectionDateTodayWhere`) — funções puras, importadas por `invoice.service.ts`/`invoice.repository.ts`. É organização de código, não muda layering acima: o helper pertence à mesma entidade e é usado pela camada que precisar.

## SQL cru (`literal`/`query`) — injection

`literal()` não escapa nada. Interpolação `${}` direta só pra **constante do código** ou **número validado com `Number.isInteger(n)`** (não basta `typeof`). Todo o resto entra parametrizado:

- **Valor** (inclusive `Date` — `${date}` vira `Thu Oct 22 2026...`, SQL inválido): `replacements` (`:name`, escapado e interpolado pelo Sequelize) ou `bind` (`$name`, parametrização real no driver). No Sequelize 6.37.8 do projeto os dois funcionam no `findAll`, mas **nunca os dois na mesma query** (lança erro) — o helper documenta qual usa e quem chama passa a mesma opção. Helper que só devolve fragmento (`customFields`, `*Where`, `QueryParser`) e não controla as options da query: `sequelize.escape(valor)` (instância de `config/sequelize`), nunca `replace(/'/g, "''")` à mão. Exige Sequelize ≥ 6.19.1 (CVE-2023-25813: `replacements` + `where` permitia injection via `:token` no texto do usuário) — não fazer downgrade.
- **Identificador** (coluna, tabela, direção de `ORDER BY`) vindo do request: replacement não serve (vira `'texto'`). Whitelist em mapa → SQL fixo, com fallback: `SORTABLE[req.query.sort] ?? SORTABLE.name`; `dir === "asc" ? "ASC" : "DESC"`.
- **Alias** de tabela: parâmetro do helper com default (`alias = "Product"`), sempre vindo do código, nunca do request, e citado com `sequelize.getQueryInterface().quoteIdentifier(alias)` — não `"${alias}"` à mão. Nunca `"Product"."id"` literal no meio do helper: se o alias gerado pelo Sequelize mudar (include, `as`), quebra em silêncio.
- **Teste**: `config/sequelize` em Jest é **sqlite** (`quoteIdentifier` cita com crase). Teste que confere SQL desses helpers mocka `config/sequelize` com `new Sequelize({ dialect: "postgres" })` sem conexão — ref. `src/shared/query/__tests__/stock-movement-query-objects.test.ts`.

## Performance de queries e chamadas

**Attributes explícitos.** Toda função nova que chama algo do backend (query Sequelize, chamada a API externa/integração) deve pedir só os campos que vai efetivamente usar — `attributes` na query Sequelize, ou equivalente na chamada externa (params/fields da API). Nunca trazer a entidade inteira "pra garantir"; resposta grande sem uso é o padrão a evitar.

**N+1 não é aceito.** Loop fazendo `await` de query (ou chamada externa) por iteração é violação, mesmo que funcione. Resolver com uma das opções, conforme o caso: rodar em paralelo (`Promise.all`), bulk (`bulkCreate`/`bulkUpdate`/`findAll` com `where: { id: { [Op.in]: ids } }`), ou passar os vários ids numa chamada só. Preferir `map`/agregação em memória sobre re-consultar por item.

**Sugestão de índices, só sob demanda.** Não sugerir índice proativamente. Se o usuário pedir (ou perguntar sobre performance de uma task que mexe numa entidade), olhar a tabela dessa entidade e onde ela é usada (filtros, joins, ordenação nas queries existentes) e sugerir os índices que ajudariam — sem criar a migration sozinho (ver regra de migração no fim deste arquivo: usuário roda `db:migrate` manualmente).

## Evitar valores hardcoded

Valor que identifica uma entidade específica (nome de integração, status, etc.) e é comparado/usado em mais de um lugar: nunca literal solto no código (`=== "Bling"`). Buscar/centralizar numa função ou variável já existente que resolve aquele valor (ex: `getBlingIntegration()` em `bling_api.service.ts`) e comparar contra o resultado dela — não recriar o literal. Assim, se o valor mudar, muda em um lugar só. Referência: `orders.service.ts`'s `getOrdersStatusSummary` compara `integration.name` com `(await getBlingIntegration()).name`, não com `"Bling"`.

## Ternário só pra valor simples

Ternário (`cond ? a : b`) só quando o resultado é valor simples (string, number, boolean, null). Resultado objeto ou array — inclusive spread condicional (`...(cond ? {...} : {})`), ternário aninhado e `cond ? await ... : []` — vira `if`/`else if` (monta a variável e preenche no `if`); fica mais legível. Vale pra código novo/alterado, sem reescrever código antigo intocado. Valor padrão com `??` (`x ?? []`) não é ternário e segue permitido.

## Comentários de código

**Todo código criado ou alterado leva comentário.** Função/método/classe exportados, constantes de config e blocos não-triviais (lock, retry, fallback, regra de negócio) ganham um comentário dizendo o que fazem e, quando houver, por quê. Código sem comentário nenhum não é aceito.

**Regra dura, sem exceção mesmo pra lógica nova/complexa (rate limiter, lock, migration): 1-2 linhas, sempre.** Direto e curto — prioriza a razão não-óbvia (constraint escondida, workaround, por que não o óbvio); nunca parágrafo, nunca bloco de 5+ linhas, mesmo que pareça "merecer" mais contexto. Se a explicação não cabe em 1-2 linhas, ela pertence em `.claude/` (ver seção seguinte), não no comentário.

## Idioma do código

Tudo dentro do código — nome de função, variável, classe, arquivo, chave de objeto, mensagem de log/erro no código-fonte — é em inglês, sem exceção. Português só em documentação (`.claude/`, comentários) e em texto voltado pro usuário final (mensagens de erro exibidas na UI, alertas).

**Texto pro usuário final é pra usuário leigo** (quem não conhece código nem tabela): erro na UI, alerta, aviso, descrição de auditoria. Nunca nome de tabela/coluna/model/classe (`ProductConfig`, `SupplierMapping`, `gtin`, `is_primary`, `external_id`) — usar o termo de negócio: "Configurações do produto", "Mapeamento DE x PARA", "Mapeamento de integração", "EAN", "Código no ERP", "Principal"; booleano como sim/não. Id técnico, quando precisar, vai no fim entre colchetes, nunca no lugar do nome. Referência: `global/audit-logs/helpers/description.ts` (`ENTITY_LABELS`/`FIELD_LABELS`).

## Contexto (`.claude/`)

- Reflete estado ATUAL do código, nunca histórico. Mudou lógica → sobrescreve; sem changelog.
- Só essencial: dependências, fluxo de dados, exceções críticas. Sem prosa, sem repetição.

## Subagentes

- Não usar para: correção pontual em 1 arquivo, pesquisa simples, tarefa de rotina.
- Usar só quando: (a) tarefas paralelizáveis independentes entre si, ou (b) pesquisa exigiria ler 5+ arquivos/módulos.
- Na dúvida: executar direto, sem subagent.
- Modelo: subagente sempre com modelo de baixo consumo — `haiku`, ou `sonnet` pra tarefa média. Nunca `opus` nem outro modelo alto; passar `model` explicitamente no Agent.

# Domain context — module reference

Documentação por módulo (por que o código é como é, causa-raiz de bugs de produção, decisões de design) não vive aqui — vive em Markdown separado em `.claude/`, por escopo:

- `.claude/entities/` — um arquivo por entidade de dado: schema/campos, relacionamentos, regras de resolução/matching, histórico de migração da entidade. Ler antes de mexer em model/service/repository dela.
- `.claude/modules/` — um arquivo por módulo/fluxo cross-cutting: arquitetura de pipeline, fluxo de execução, dependências externas, coordenação de fila. Ler antes de mexer em auth/scoping, pipeline ML→Bling, integração Tecinco/Bling, ou relatórios.

**Manter atualizado**: mudança nesta conversa que altera fato documentado (campo novo, bug de tenant-scoping corrigido/achado, ordem de resolução mudou, trigger/constraint novo) → atualizar o arquivo correspondente em `.claude/entities/` ou `.claude/modules/` no mesmo turno — não deixar defasar. Não existe arquivo pro assunto → criar novo, não engordar este arquivo. Arquivo com comentário `<!-- Next session: ... -->` no topo (pendente de verificação contra commits recentes) → resolver a nota (verificar conteúdo, atualizar, remover comentário) antes de confiar no resto do arquivo.

## Index

**Entities** (`.claude/entities/`):
- `product/` — Product+ProductConfig+SupplierMapping como um sistema só
  - `index.md` — visão geral, link pros filhos
  - `core.md` — Product: tenant-scoping, code lookup, query config, category enum, FK-on-delete, resolução por external id
  - `config.md` — ProductConfig, `gtin_erp` (só leitura), remoção do gtin_package
  - `supplier-mapping.md` — SupplierMapping schema, triggers, createFromUnmapped
  - `tecinco/automap-cascade.md` — fallback SKU/SupplierMapping (Bling + Tecinco)
  - `tecinco/catalog-preflight.md` — detecção de código duplicado no catálogo Tecinco antes do enqueue
  - `tecinco/duplicate-protection.md` — skuOmitted/eanOmitted, triggers DB, create/map manual de duplicata
  - `bling/deactivation.md` — Bling situacao=E
  - `physical-ean-owner.md` — "Confirmar EAN físico" (`is_physical_override`), validação de EAN por integração com zero à esquerda, códigos de erro
  - `tire-search.md` — auto busca de pneu: medida estrita no nome, pontuação por índice/marca, IN_BATCH vs NORMAL
  - `merge-duplicate.md` — runbook SQL manual pra substituir produto duplicado (antigo → novo) em todas as tabelas e apagar o antigo
- `supplier-discount-rule.md` — matching engine, eixos de escopo, coluna computada `name`
- `integration-mapping.md` — tabela `integration_mappings`, `is_primary` (gate de sync) e `erp_data`, incidente de mapping órfão, regras cross-external-id
- `audit-log.md` — tabela `audit_logs`: gravação explícita na service, description pra leigo, entrada principal + afetadas
- `unmapped-entity.md` — tabela genérica `unmapped_entities` (valor da integração sem `integration_mapping`, hoje forma de pagamento Bling), rotas listar + `POST /:id/map`
- `integration-error.md` — tabela genérica `integration_errors`, upsert-by-find/dedup, logger centralizado (`IntegrationLoggerService`, flag `createIntegrationError`)
- `unmapped-invoice-product/` — fila de revisão manual
  - `index.md` — regras `type`/dedup, schema
  - `create-flow.md` — fluxo create-product-from-unmapped
- `invoice/` — Invoice/InvoiceItems/InvoiceFiscalItem, import XML NF-e
  - `index.md` — visão geral, FK-on-delete, filtros/fixes menores, auth, `tracking_url` (link de rastreio, só Bling), carta de correção (libera nota CD 12/17 sem transferência no lote)
  - `item-resolution.md` — ordem de resolução de produto, cascata de mapeamento manual, fixes de duplicate-key
  - `ml-shipping-filters.md` — filtros da fila de shipping Mercado Livre
  - `supplier-discount/filter.md` — filtros `rim`/`supplier_discount`
  - `supplier-discount/report-value.md` — valor de desconto por linha nos relatórios
  - `supplier-discount/unit-business-bypass.md` — bypass de loja só no relatório de produto
- `unit-business-group.md` — UnitBusinessGroup + pivot `unit_business_group_members` (N:N de unit businesses), rotas, permissão
- `contact.md` — Contact (vendedores e afiliados): tipos `SELLER`/`SELLER_MANAGER` (gerente da loja/regional, comissão de gerente por períodos em `custom_data.manager_periods`)/`AFFILIATED`, `SELLER_CONTACT_TYPES` nas buscas de vendedor do Bling, `id_system` opcional, rota `/with-user` (User + Contact) e login/me do afiliado
- `customer.md` — Customer: enum `type`, documento nullable, fallback quando Bling manda `tipoPessoa`/`numeroDocumento` vazios
- `ticket.md` — Ticket: `requester_user_id` obrigatório no body (não é o logado), `opened_by`/`closed_by` pelo usuário logado, backfill m336
- `coupon.md` — cupons (`coupons`/`contact_coupons`/`order_coupons`): vínculo afiliado ↔ cupom, índices parciais, nunca deleta, comissão congelada por pedido (`registerFromMagento`)
- `store.md` — Store (tipo canal de venda, não filial), fix de dedup
- `stock-movement.md` — módulo stock/stock_movements
- `inventory-batch.md` — InventoryBatch/Items/Logs (contagem de inventário), modos FIXED/CYCLIC, gate de integration mapping
- `expedition-batch/` — módulo expedition batch
  - `index.md` — repository/scan-logs, auth, bloqueio por produto não mapeado
  - `add-invoice-to-batch.md` — rewrite bulk + fix de numeração
  - `last-outgoing-batch.md` — ponteiro `last_outgoing_batch_pending`
  - `pdv-sales-request.md` — lote/romaneio do PDV no CD21: 3 ações por coluna (SHIPPING/SHIP_TODAY), só login CD21, grupo por transportadora com sucesso parcial
  - `transshipment.md` — transbordo (loja nem emissora nem destinatária): `is_transshipment` por nota no lote, 2 linhas de atributo por `type` no CD, entrada finalizada antes da expedição, sem Tecinco/estoque, escopo do hasOne `batchInvoice`
- `order/` — Orders
  - `index.md` — base, auth, divergência `internal_status`/`status_snapshot`, catálogo `payment_methods`/`payment_method_id`
  - `status-sync.md` — `reason_cancelled`, `syncOrderInternalStatus`/`escalateToHumanVerificationIfStillPending`
  - `summary-endpoints.md` — repository facts dos endpoints de summary
- `pdv-sales-request/` — módulo PDV Management (solicitação Loja→Financeiro→CD21), Etapa 1 completa (Passo A + Passo B)
  - `index.md` — schema, máquina de estados, vínculo de nota de transferência, análise de comprovante por IA, pendência (Etapa 2)

**Modules** (`.claude/modules/`):
- `auth.md` — modelo de tenant/auth scoping cross-cutting, controllers corrigidos vs. ainda vazando entre tenants. Ler primeiro antes de mexer em auth.
- `ml-order-pipeline/` — pipeline de 6 filas ML→Bling NFe. Ver também `docs/automation/order-pipeline.md` (referência viva da state machine — é ele que se atualiza pra mudança de tabela de estado/lock, não os arquivos daqui)
  - `index.md` — visão geral, link pros filhos
  - `bug-fixes.md` — 3 bugs de sync, `reason_cancelled`, escrita antecipada de status
  - `collection-date.md` — origem do `collection_date`, redesign do `ML-SCRAPING`, bug de timezone
  - `summary-endpoints.md` — endpoints Orders summary/detail, janela 06h–14h, escopo store-only
  - `locks.md` — `BLING_SHARED_QUEUE_LOCK`, aging, lock por pedido
  - `rate-limit.md` — rate limit Bling compartilhado, race no dispatch, env docker-compose
- `bling-nfe-scraping.md` — automação Playwright do Bling pra manifestação de NFe
- `bling-api-client.md` — trava de escrita por `NODE_ENV` no client Bling (Tecinco e Magento têm a mesma trava: ver `tecinco-api.md`/`magento-sync.md`) (só GET fora de produção), token liberado (app Bling próprio em dev), o que não é coberto
- `bling-poll.md` — TEMPORÁRIO (webhooks Bling fora): tasks no `BLING_RECONCILER` — novos a cada 1min (NF-e saída/cancelada/entrada + pedidos ausentes no banco) e alterações a cada 20min (até 50 pedidos por `dataAlteracaoInicial`, NF-e por mudança de situação); criação com prioridade sobre atualização (job de novos ignora pendentes `bling-poll-update`; atualização só com `BLING_API_FETCH`/`BLING_ORDER_INGESTION` vazias); flag `BLING_POLL_ENABLED`; `reconcileChangedOrders` (pedidos divergentes no fim da migração diária, cursor próprio); quirks de filtro de data da API Bling
- `bling-sync-routes.md` — rotas `/api/bling-sync` (populate em massa em background de produto/nota/pedido com limite), auth usuário ou application, lock/status em Redis
- `manual-import.md` — import manual por integração (`/api/manual-import`, Bling: produto/nota/pedido; Tecinco: produto/nota): busca → escolha → fila com prioridade 1, lock por usuário + claim por item no Redis, andamento por polling
- `tecinco-api.md` — sessão/login da API Tecinco, fix de race de login
- `reports.md` — módulo de snapshot de sales-report; operação diária com snapshot por `type` e transbordo contado à parte; fila única `ReportQueue` de 1h (seller → sales → daily operation) e lock com expiração
- `integration-pending-report.md` — relatório de pendências de integração (overrides, produto com 2+ códigos no ERP, EAN duplicado no ERP, SKU duplicado no ERP, sem EAN, não mapeado), só admin/developer, sem paginação
- `datafrete-cte-sync.md` — sync de CT-e (entidade `ctes`) com a API da Datafrete: fluxo `CteIngestionQueue`→`SyncDatafreteCteService`, coluna `synched`, client de endpoints de CT-e da Datafrete
- `sieg-rate-limits.md` — limites documentados por rota da API Sieg (ex.: `/v1/baixar-xmls` = 2 req/min, 50 XMLs/req) vs. limite genérico não-confirmado, onde cada um é aplicado no código
- `magento-sync.md` — sync Bling→Magento de produtos: `external_id` = `entity_id` do Magento (não sku), resolução por id (mapeado) vs. sku/nome (1ª vez)
- `ai-vision-extraction.md` — cliente Gemini (`GeminiVisionService`) + pipeline de extração de documento (PDF nativo vs. binário/IA), consumido hoje só pelo módulo PDV (comprovante + fallback de DANFE)
- `uploader-queue.md` — fila única (`UploaderQueue`) pra todo upload/delete no `UploaderService`: staging genérico `temp_files`, dois modos de uso (resposta instantânea com finalização automática vs. espera síncrona), prioridade, cache de imagem, rate limit e sweep de reconciliação

Migração: como qualquer outra deste repo, **usuário roda `db:migrate` (ou qualquer DDL) manualmente — nunca automatizar.**
