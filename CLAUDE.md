# Architecture rules

## Layer separation: repository / service / controller

Segue `BaseRepository`/`BaseService`/`BaseController` (`src/shared/utils/base-models/`). Cada camada só fala com a mesma camada de outras entidades — nunca pula pra camada de baixo.

- **Repository**: só a própria model Sequelize. Precisa de dado de outra entidade fora de um `include`? Chama a **repository** dela — nunca a model direto.
- **Service**: regra de negócio/orquestração. Precisa de outra entidade? Chama o **service** dela (`productConfigService`, `supplierMappingService`) — nunca model/repository direto, nem leitura.
- **Controller**: só request/response (params, auth context, status code); delega pro próprio service.

`include` (eager-load numa query) é permitido só na camada **repository**, quando a query já é da própria model — não conta como "chamar outra entidade", é join. Query separada contra outra model (`ProductConfig.findOne()` dentro de `ProductService`) é violação, mesmo só leitura.

**Esse carve-out do `include` é só pra repository — não pra service.** Mesmo dentro da própria entidade, nenhuma query na service pode referenciar outra model — nem um `include` simples de eager-load. Isso vira método nomeado na repository da entidade (ex: `unmappedInvoiceProductRepository.findUnmappedByInvoiceIds`, `findByCodeExcluding`), e a service só chama o método — nunca monta `include`/`where` ela mesma. Exceção: `BaseService.findAll`/`findOne` com `where` simples, sem `include`, direto na service — ok, não referencia outra model. Padrão de referência: `unmapped-invoice-product.repository.ts` (`getFullById`, `findUnmappedByInvoiceIds`, `findByCodeExcluding`) + `unmapped-invoice-product.service.ts`'s `findCascadeMatches` (repository monta a query, service só filtra CNPJ normalizado).

Antes de criar método pra buscar dado de outra entidade: checar `BaseRepository`/`BaseService`/`BaseController` primeiro — geralmente já existe `findOne`/`findById`/`findAll` genérico; a solução costuma ser chamar `<entity>Service.findOne(...)`, não escrever query nova.

## Helpers de query/filtro reutilizáveis

Lógica de query (fragmento `where`, `Sequelize.literal`, etc.) não-trivial e reutilizável por mais de um filtro/método: função nomeada, exportada, parametrizada em `helpers/` da própria entidade (ex: `invoice/helpers/`) — nunca função solta/closure dentro do service/repository. Parametrizar pelo que varia entre chamadas (nome de loja, unit business id, alias de tabela, data de referência), não hardcoded pro primeiro caso de uso. Referência: `invoice/helpers/totals.ts` (`totalExpectedLiteral`/`totalReadLiteral`), `invoice/helpers/custom-filters.ts` (`storeCollectionDateTodayWhere`) — funções puras, importadas por `invoice.service.ts`/`invoice.repository.ts`. É organização de código, não muda layering acima: o helper pertence à mesma entidade e é usado pela camada que precisar.

## Comentários de código

Curtos, diretos, 1-2 linhas. Só a razão não-óbvia (constraint escondida, workaround, por que não o óbvio) — nunca parágrafo explicando o que o código já mostra.

## Contexto (`.claude/`)

- Reflete estado ATUAL do código, nunca histórico. Mudou lógica → sobrescreve; sem changelog.
- Só essencial: dependências, fluxo de dados, exceções críticas. Sem prosa, sem repetição.

## Subagentes

- Não usar para: correção pontual em 1 arquivo, pesquisa simples, tarefa de rotina.
- Usar só quando: (a) tarefas paralelizáveis independentes entre si, ou (b) pesquisa exigiria ler 5+ arquivos/módulos.
- Na dúvida: executar direto, sem subagent.

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
  - `config.md` — ProductConfig, remoção do gtin_package
  - `supplier-mapping.md` — SupplierMapping schema, triggers, createFromUnmapped
  - `tecinco/automap-cascade.md` — fallback SKU/SupplierMapping (Bling + Tecinco)
  - `tecinco/catalog-preflight.md` — detecção de código duplicado no catálogo Tecinco antes do enqueue
  - `tecinco/duplicate-protection.md` — skuOmitted/eanOmitted, triggers DB, create/map manual de duplicata
  - `bling/deactivation.md` — Bling situacao=E
- `supplier-discount-rule.md` — matching engine, eixos de escopo, coluna computada `name`
- `integration-mapping.md` — tabela `integration_mappings`, incidente de mapping órfão, regras cross-external-id
- `unmapped-invoice-product/` — fila de revisão manual
  - `index.md` — regras `type`/dedup, schema
  - `create-flow.md` — fluxo create-product-from-unmapped
- `invoice/` — Invoice/InvoiceItems/InvoiceFiscalItem, import XML NF-e
  - `index.md` — visão geral, FK-on-delete, filtros/fixes menores, auth
  - `item-resolution.md` — ordem de resolução de produto, cascata de mapeamento manual, fixes de duplicate-key
  - `ml-shipping-filters.md` — filtros da fila de shipping Mercado Livre
  - `supplier-discount/filter.md` — filtros `rim`/`supplier_discount`
  - `supplier-discount/report-value.md` — valor de desconto por linha nos relatórios
  - `supplier-discount/unit-business-bypass.md` — bypass de loja só no relatório de produto
- `store.md` — Store (tipo canal de venda, não filial), fix de dedup
- `stock-movement.md` — módulo stock/stock_movements
- `expedition-batch/` — módulo expedition batch
  - `index.md` — repository/scan-logs, auth, bloqueio por produto não mapeado
  - `add-invoice-to-batch.md` — rewrite bulk + fix de numeração
  - `last-outgoing-batch.md` — ponteiro `last_outgoing_batch_pending`
- `order/` — Orders
  - `index.md` — base, auth, divergência `internal_status`/`status_snapshot`
  - `status-sync.md` — `reason_cancelled`, `syncOrderInternalStatus`/`escalateToHumanVerificationIfStillPending`
  - `summary-endpoints.md` — repository facts dos endpoints de summary

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
- `tecinco-api.md` — sessão/login da API Tecinco, fix de race de login
- `reports.md` — módulo de snapshot de sales-report

Migração: como qualquer outra deste repo, **usuário roda `db:migrate` (ou qualquer DDL) manualmente — nunca automatizar.**
