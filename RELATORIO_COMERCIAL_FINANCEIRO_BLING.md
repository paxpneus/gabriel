# Relatório Comercial e Financeiro com dados de ERP

Este documento descreve tudo que precisa ser alterado/adicionado no backend da PAX Pneus para gerar um relatório comercial e financeiro com visões por estado, geral, produto, loja e status, usando dados de ERPs integrados, XML de NF-e e custo médio do estoque.

A Bling é a primeira integração considerada neste desenho, mas a estrutura não deve ficar presa a ela. No futuro, o mesmo relatório deve receber dados da Tecinco ou de outro ERP sem alterar as tabelas analíticas principais.

O sistema já possui três entidades estruturais que cobrem completamente a origem e contexto de cada dado:

- `integrations` → de onde veio o dado (Bling, Tecinco, etc.)
- `stores` → canal de venda (Mercado Livre, Shopee, loja virtual, etc.)
- `unit_businesses` → filial/unidade operacional física

Por isso, **não há campos `source_system` ou `external_*` genéricos** nas tabelas operacionais. Cada conector/adapter deve traduzir seu payload para esse modelo canônico usando as FKs existentes.

O desenho segue o mesmo padrão do relatório diário operacional já existente em `src/modules/reports/daily-operation-report`:

- um job incremental com checkpoint em `report_job_checkpoints`;
- uma tabela de snapshot granular, congelando os dados derivados por pedido/item;
- tabelas de facts agregadas para consulta rápida;
- `ON CONFLICT DO UPDATE` para upsert idempotente;
- recalculo das chaves antigas e novas quando um pedido muda de data, loja, UF ou status.

## 1. Objetivo do relatório

O relatório precisa entregar estas visões.

### Por estado

- Número de pedidos.
- Quantidade de volumes.
- Valor total.
- Frete médio.
- Ticket médio.

### Geral

- Número de pedidos.
- Quantidade de volumes.
- Valor total.
- Frete.
- Ticket médio.

### Por produto

- Quantidade.
- Custo.
- Valor.
- Markup.

### Por loja

- Quantidade de pedidos.
- Ticket médio.
- Quantidade de volumes.
- Custo.
- Valor.
- Frete.
- Valor peça.
- Markup.
- Impostos.
- Taxas.
- Contribuição em valor.
- Contribuição em percentual.
- Quantidade e valor por status.

## 2. Regras importantes já definidas

### 2.1. Não confiar em volume de transportadora

Para este relatório, `transporte.quantidadeVolumes`, `produto.volumes` e volumes da transportadora não devem ser usados como quantidade vendida.

Para pneus, a quantidade de volumes/peças deve ser:

```txt
quantidade_volumes = SUM(itens.quantidade)
```

Ou seja, sempre usar a quantidade dos itens vendidos.

Exemplo:

```txt
Pedido com 1 item de pneu e quantidade 4
quantidade_volumes = 4
```

Mesmo se o ERP retornar `transporte.quantidadeVolumes = 0`, o relatório deve considerar 4 volumes/peças.

### 2.2. Custo deve ser custo médio

O relatório não deve usar diretamente o custo do fornecedor informado pelo ERP como custo definitivo da venda. Esse custo é útil para alimentar o cadastro e o estoque, mas a regra do relatório deve ser:

```txt
Custo Médio = Valor Total Gasto com o Estoque Atual / Quantidade Total de Itens no Estoque
```

No banco atual, a tabela `stocks` já tem:

```txt
stocks.total_price
stocks.quantity
```

Logo:

```txt
average_cost = stocks.total_price / stocks.quantity
```

Se `quantity = 0`, o custo médio deve cair para um fallback definido pela regra de negócio, como `products.supplier_cost_price`, e o snapshot deve marcar que houve fallback. Para relatórios históricos, o que manda é o snapshot do período: se no momento da venda havia estoque/custo médio, usa o custo médio daquela época; se não havia custo confiável, o pedido deve aparecer com `has_cost_fallback = true` para auditoria.

### 2.3. Congelar o custo no momento da venda

O custo médio muda quando entram novas compras, devoluções ou ajustes de estoque. Por isso, o relatório histórico não pode recalcular custo antigo usando o custo médio atual.

Cada item vendido precisa gravar um snapshot:

```txt
average_cost_snapshot
total_cost_snapshot = average_cost_snapshot * quantity
```

Sem esse snapshot, um relatório de janeiro pode mudar em março apenas porque o custo médio do estoque mudou.

### 2.4. Pedido é fonte comercial, NF-e/XML é fonte fiscal

Use cada ERP assim:

- Pedido de venda: total comercial, loja, status, itens, frete cobrado, taxas, data.
- Produto: cadastro, preço, fornecedor, custo do fornecedor, GTIN, marca, NCM/CEST, peso.
- Nota fiscal e XML: UF real do destinatário, valor fiscal, impostos, CFOP, NCM, chave, número da nota, frete fiscal.

## 3. Modelo canônico de integração

O sistema separa três camadas:

```txt
ERP externo (Bling, Tecinco, etc.)
  -> adapter/conector de ingestão
  -> tabelas canônicas do sistema (integrations, stores, unit_businesses como FKs)
  -> snapshots/facts do relatório
```

As tabelas de venda, produto, nota e relatório **não têm colunas `source_system`** porque a origem é sempre resolvida por `integrations_id` (FK para `integrations`). O nome do ERP é `integrations.name`; o tipo é `integrations.type`.

Mapeamento canônico:

```txt
"De onde veio?"          → integrations_id (FK → integrations)
"Qual canal de venda?"   → store_id (FK → stores)
"Qual filial/unidade?"   → unit_business_id (FK → unit_businesses)
"Id do registro no ERP?" → campos *_system já existentes:
                           orders.id_order_system
                           orders.number_order_system
                           orders.number_order_channel
                           products.id_system
                           invoices.id_system / xml_key
```

Se algum ERP tiver campo muito específico sem equivalente canônico, usar `source_payload JSONB` nas tabelas de snapshot — não nas tabelas operacionais principais.

Exemplos de mapeamento por ERP:

```txt
Bling pedido data.id        -> orders.id_order_system
Bling pedido data.numero    -> orders.number_order_system
Bling pedido data.numeroLoja -> orders.number_order_channel
Bling loja.id               -> stores (buscar/criar por external lookup)
Bling loja.unidadeNegocio.id -> unit_businesses (buscar/criar por external lookup)
Bling situacao              -> via integration_mappings (status normalizado)

Tecinco pedido id           -> orders.id_order_system
Tecinco pedido numero       -> orders.number_order_system
(campos adicionais)         -> source_payload no snapshot
```

## 4. O que a Bling entrega

### 4.1. Pedido de venda

Campos úteis do pedido:

```txt
data.id
data.numero
data.numeroLoja
data.data
data.dataSaida
data.totalProdutos
data.total
data.contato.id
data.contato.nome
data.contato.tipoPessoa
data.contato.numeroDocumento
data.situacao.id
data.situacao.valor
data.loja.id                     -> stores (via lookup)
data.loja.unidadeNegocio.id      -> unit_businesses (via lookup)
data.outrasDespesas
data.desconto.valor
data.desconto.unidade
data.notaFiscal.id               -> busca da invoice via id_system
data.tributacao.totalICMS
data.tributacao.totalIPI
data.itens[].id
data.itens[].codigo
data.itens[].descricao
data.itens[].quantidade
data.itens[].valor
data.itens[].desconto
data.itens[].produto.id
data.itens[].comissao.base
data.itens[].comissao.aliquota
data.itens[].comissao.valor
data.transporte.fretePorConta
data.transporte.frete
data.transporte.quantidadeVolumes  -> NÃO usar para volumes do relatório
data.transporte.pesoBruto
data.taxas.taxaComissao
data.taxas.custoFrete
data.taxas.valorBase
```

Pontos de atenção:

- `transporte.quantidadeVolumes` pode vir zerado. Não usar para volumes do relatório.
- `transporte.etiqueta.uf` pode vir vazio. Para UF, preferir NF-e/XML.
- `taxas.custoFrete` pode representar custo de frete pago pela operação, mas precisa ser validado contra a regra real de cada canal.
- `situacao.valor` deve ser normalizado via `integration_mappings`.

### 4.2. Nota fiscal

Campos úteis da nota:

```txt
data.id
data.situacao
data.numero
data.dataEmissao
data.dataOperacao
data.chaveAcesso
data.contato.endereco.uf
data.contato.endereco.municipio
data.loja.id
data.valorNota
data.valorFrete
data.xml
data.itens[].codigo
data.itens[].descricao
data.itens[].quantidade
data.itens[].valor
data.itens[].valorTotal
data.itens[].pesoBruto
data.itens[].pesoLiquido
data.itens[].classificacaoFiscal
data.itens[].cest
data.itens[].gtin
data.itens[].cfop
data.itens[].impostos.valorAproximadoTotalTributos
data.itens[].impostos.icms.aliquota
data.itens[].impostos.icms.valor
```

### 4.3. XML da NF-e

O XML é extremamente importante para relatório fiscal porque traz valores consolidados e detalhes tributários por item.

Campos úteis:

```txt
dest/enderDest/UF
dest/enderDest/xMun
ide/nNF
ide/serie
ide/dhEmi
det/prod/cProd
det/prod/xProd
det/prod/qCom
det/prod/vUnCom
det/prod/vProd
det/prod/NCM
det/prod/CEST
det/prod/CFOP
det/imposto/vTotTrib
det/imposto/ICMS/*/pICMS
det/imposto/ICMS/*/vICMS
det/imposto/ICMSUFDest/vICMSUFDest
det/imposto/IBSCBS/gIBSCBS/gIBSUF/vIBSUF
det/imposto/IBSCBS/gIBSCBS/gIBSMun/vIBSMun
det/imposto/IBSCBS/gIBSCBS/gCBS/vCBS
total/ICMSTot/vProd
total/ICMSTot/vFrete
total/ICMSTot/vDesc
total/ICMSTot/vOutro
total/ICMSTot/vNF
total/ICMSTot/vTotTrib
total/ICMSTot/vICMS
total/ICMSTot/vIPI
total/ICMSTot/vPIS
total/ICMSTot/vCOFINS
total/ICMSTot/vICMSUFDest
```

O projeto já possui `fast-xml-parser` e `xml2js` no `package.json`.

### 4.4. Produto

Campos úteis do produto da Bling:

```txt
data.id
data.nome
data.codigo
data.preco
data.estoque.saldoVirtualTotal
data.unidade
data.pesoLiquido
data.pesoBruto
data.gtin
data.gtinEmbalagem
data.marca
data.fornecedor.id
data.fornecedor.contato.id
data.fornecedor.contato.nome
data.fornecedor.codigo
data.fornecedor.precoCusto
data.fornecedor.precoCompra
data.tributacao.ncm
data.tributacao.cest
```

Pontos de atenção:

- `fornecedor.precoCusto` alimenta `products.supplier_cost_price` e o vínculo `product_supplier_maps`.
- O fornecedor é mapeado via `supplier_id` (FK → `suppliers`).
- O custo do relatório deve ser custo médio do estoque, não o custo do fornecedor.
- `estoque.saldoVirtualTotal` pode ajudar conciliação, mas o cálculo oficial usa o estoque interno.

## 5. O que falta no sistema atual

### 5.1. `orders`

Campos já existentes e suficientes para identificação canônica:

```txt
integrations_id        -> de qual ERP/canal
store_id               -> canal de venda
unit_business_id       -> filial (adicionado na última migration)
invoice_id             -> nota fiscal vinculada (adicionado na última migration)
id_order_system        -> id do pedido no ERP
number_order_system    -> número do pedido no ERP
number_order_channel   -> número do pedido no canal de venda
customer_id
```

Faltam apenas campos comerciais/financeiros:

```txt
total_products
total_order
discount_value
discount_type
other_expenses
freight_charged
freight_cost
freight_by_account
gross_weight
tax_commission
tax_base_value
marketplace_fee
payment_fee
```

Obs.: campos como `external_id`, `external_number`, `external_status_id`,
`external_status_name`, `external_store_id`, `source_system` foram removidos
nas migrations porque já são cobertos pelo modelo canônico existente.

### 5.2. `order_items`

Campos já existentes:

```txt
order_id, product_id, name, sku, unit, quantity, price
```

Faltam:

```txt
unit_price
gross_total
discount_value
net_total
commission_base
commission_rate
commission_value
average_cost_snapshot
total_cost_snapshot
cost_source
```

`cost_source` pode ser:

```txt
STOCK_AVERAGE
PRODUCT_SUPPLIER_COST
ZERO_STOCK
MANUAL
UNKNOWN
```

Obs.: campos `external_item_id`, `external_product_id` e `source_system` foram
removidos nas migrations. Detalhes de item do ERP que precisem de auditoria
devem ir em `source_payload` no snapshot correspondente.

### 5.3. `products`

Campos já existentes:

```txt
id_system, name, sku, ean, price, type, integrations_id, supplier_id (novo FK)
```

Faltam campos de cadastro enriquecido:

```txt
unit
brand
gross_weight
net_weight
gtin
gtin_package
ncm
cest
supplier_cost_price
supplier_purchase_price
average_cost
average_cost_updated_at
```

Obs.: campos `source_system`, `external_id`, `supplier_external_id`,
`supplier_contact_id`, `supplier_name`, `supplier_product_code` foram removidos
nas migrations. A origem é coberta por `integrations_id`; dados do fornecedor
pertencem a `suppliers` e `product_supplier_maps`.

### 5.4. `stocks`

Hoje `stocks` tem:

```txt
product_id, unit_business_id, total_price, quantity
```

Isso é suficiente para custo médio, desde que `total_price` represente o valor
total gasto com o estoque atual.

Ações recomendadas:

- Garantir unicidade composta `(product_id, unit_business_id)` — não individual.
- Padronizar atualizações de entrada/saída para manter `total_price` e `quantity` corretos.

### 5.5. `invoices`

Campos já existentes:

```txt
unit_business_id, store_id, integrations_id, transporter_id
xml_key, xml_path, danfe_path, id_system
sender_cnpj/name, receiver_cnpj/name
type, status, emitted_at, received_at
```

Obs.: `external_id` e `source_system` foram removidos nas migrations. A origem
é coberta por `integrations_id`; o id externo fica em `id_system`.

Faltam campos fiscais para o relatório:

```txt
invoice_number
invoice_series
invoice_value
invoice_products_value
invoice_freight_value
invoice_discount_value
invoice_other_value
invoice_total_tax_value
icms_value
ipi_value
pis_value
cofins_value
difal_value
ibs_value
cbs_value
destination_uf
destination_city
xml_url
source_payload
```

### 5.6. `invoice_items`

Hoje voltada para operação de recebimento/expedição. Não guarda valores fiscais.

Recomendação: criar tabela `invoice_fiscal_items` separada (ver seção 10.2).

## 6. Modelo recomendado de tabelas para o relatório

Estrutura equivalente ao relatório diário operacional:

```txt
sales_order_snapshots
sales_order_item_snapshots
daily_sales_facts
daily_sales_state_facts
daily_sales_store_facts
daily_sales_product_facts
daily_sales_status_facts
```

## 7. Tabela `sales_order_snapshots`

Snapshot por pedido. Uma linha por pedido vendido.

Campos recomendados:

```txt
id UUID PK
order_id UUID UNIQUE FK orders.id
invoice_id UUID NULL FK invoices.id
integration_id UUID NULL FK integrations.id
customer_id UUID NULL FK customers.id
store_id UUID NULL FK stores.id
unit_business_id UUID NULL FK unit_businesses.id

order_number_system VARCHAR(100)       -- orders.number_order_system
order_number_channel VARCHAR(100)      -- orders.number_order_channel
invoice_number VARCHAR(100)
invoice_key VARCHAR(255)

order_date DATE NOT NULL
invoice_date DATE NULL
emitted_at TIMESTAMP NULL

destination_uf VARCHAR(2)
destination_city VARCHAR(100)

status_snapshot VARCHAR(100)           -- valor normalizado via integration_mappings
snapshot_status VARCHAR(30)

items_quantity INTEGER DEFAULT 0

total_products NUMERIC(14,2) DEFAULT 0
total_order NUMERIC(14,2) DEFAULT 0
discount_value NUMERIC(14,2) DEFAULT 0
other_expenses NUMERIC(14,2) DEFAULT 0

freight_charged NUMERIC(14,2) DEFAULT 0
freight_cost NUMERIC(14,2) DEFAULT 0
freight_paid_by_company BOOLEAN DEFAULT FALSE
freight_by_account INTEGER NULL

total_cost NUMERIC(14,2) DEFAULT 0
total_taxes NUMERIC(14,2) DEFAULT 0
total_fees NUMERIC(14,2) DEFAULT 0

tax_commission NUMERIC(14,2) DEFAULT 0
marketplace_fee NUMERIC(14,2) DEFAULT 0
payment_fee NUMERIC(14,2) DEFAULT 0

icms_value NUMERIC(14,2) DEFAULT 0
ipi_value NUMERIC(14,2) DEFAULT 0
pis_value NUMERIC(14,2) DEFAULT 0
cofins_value NUMERIC(14,2) DEFAULT 0
difal_value NUMERIC(14,2) DEFAULT 0
ibs_value NUMERIC(14,2) DEFAULT 0
cbs_value NUMERIC(14,2) DEFAULT 0
approx_tax_value NUMERIC(14,2) DEFAULT 0

contribution_value NUMERIC(14,2) DEFAULT 0
contribution_pct NUMERIC(8,2) DEFAULT 0
markup_pct NUMERIC(8,2) DEFAULT 0

has_cost_fallback BOOLEAN DEFAULT FALSE
has_invoice_data BOOLEAN DEFAULT FALSE
source_payload JSONB NULL              -- payload bruto do ERP para auditoria
last_updated_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

Índices/constraints:

```txt
UNIQUE(order_id)
INDEX(order_date)
INDEX(order_date, store_id)
INDEX(order_date, unit_business_id)
INDEX(order_date, destination_uf)
INDEX(order_date, integration_id)
INDEX(invoice_id)
```

Obs.: não há `external_order_id`, `external_order_number`, `external_invoice_id`
nem `source_system` neste snapshot. A origem é `integration_id` (FK);
os números do ERP ficam em `order_number_system` e `order_number_channel`,
copiados de `orders`.

### Fórmulas no snapshot do pedido

```txt
items_quantity = SUM(sales_order_item_snapshots.quantity)
total_cost = SUM(sales_order_item_snapshots.total_cost_snapshot)
total_taxes = icms + ipi + pis + cofins + difal + ibs + cbs
total_fees = tax_commission + marketplace_fee + payment_fee

contribution_value =
  total_order
  - total_cost
  - CASE WHEN freight_paid_by_company THEN freight_cost ELSE 0 END
  - total_taxes
  - total_fees

contribution_pct =
  CASE WHEN total_order = 0 THEN 0
  ELSE contribution_value / total_order * 100
  END

markup_pct =
  CASE WHEN total_cost = 0 THEN 0
  ELSE (total_order - total_cost) / total_cost * 100
  END
```

## 8. Tabela `sales_order_item_snapshots`

Snapshot por item vendido. Uma linha por item do pedido.

Campos recomendados:

```txt
id UUID PK
order_snapshot_id UUID FK sales_order_snapshots.id
order_id UUID FK orders.id
order_item_id UUID NULL FK order_items.id
product_id UUID NULL FK products.id
store_id UUID NULL FK stores.id
unit_business_id UUID NULL FK unit_businesses.id
integration_id UUID NULL FK integrations.id

order_date DATE NOT NULL
destination_uf VARCHAR(2)

sku VARCHAR(100)
description VARCHAR(255)
unit VARCHAR(20)

quantity NUMERIC(14,4) DEFAULT 0
unit_price NUMERIC(14,4) DEFAULT 0
gross_total NUMERIC(14,2) DEFAULT 0
discount_value NUMERIC(14,2) DEFAULT 0
net_total NUMERIC(14,2) DEFAULT 0

average_cost_snapshot NUMERIC(14,4) DEFAULT 0
total_cost_snapshot NUMERIC(14,2) DEFAULT 0
cost_source VARCHAR(30)

markup_pct NUMERIC(8,2) DEFAULT 0

commission_base NUMERIC(14,2) DEFAULT 0
commission_rate NUMERIC(8,4) DEFAULT 0
commission_value NUMERIC(14,2) DEFAULT 0

ncm VARCHAR(20)
cest VARCHAR(20)
cfop VARCHAR(20)
gtin VARCHAR(20)

approx_tax_value NUMERIC(14,2) DEFAULT 0
icms_rate NUMERIC(8,4) DEFAULT 0
icms_value NUMERIC(14,2) DEFAULT 0
ipi_value NUMERIC(14,2) DEFAULT 0
pis_value NUMERIC(14,2) DEFAULT 0
cofins_value NUMERIC(14,2) DEFAULT 0
difal_value NUMERIC(14,2) DEFAULT 0
ibs_value NUMERIC(14,2) DEFAULT 0
cbs_value NUMERIC(14,2) DEFAULT 0

source_payload JSONB NULL
last_updated_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

Índices:

```txt
INDEX(order_snapshot_id)
INDEX(order_date, product_id)
INDEX(order_date, sku)
INDEX(order_date, store_id)
INDEX(order_date, unit_business_id)
INDEX(order_date, destination_uf)
```

### Fórmulas por item

```txt
quantity = ERP pedido itens[].quantidade
gross_total = unit_price * quantity
net_total = gross_total - discount_value

average_cost_snapshot = stocks.total_price / stocks.quantity
total_cost_snapshot = average_cost_snapshot * quantity

markup_pct =
  CASE WHEN total_cost_snapshot = 0 THEN 0
  ELSE (net_total - total_cost_snapshot) / total_cost_snapshot * 100
  END
```

Custo (pseudo-SQL):

```sql
CASE
  WHEN s.quantity > 0 THEN ROUND((s.total_price::numeric / s.quantity::numeric), 4)
  WHEN p.supplier_cost_price IS NOT NULL THEN p.supplier_cost_price
  ELSE 0
END AS average_cost_snapshot,

CASE
  WHEN s.quantity > 0 THEN 'STOCK_AVERAGE'
  WHEN p.supplier_cost_price IS NOT NULL THEN 'PRODUCT_SUPPLIER_COST'
  ELSE 'UNKNOWN'
END AS cost_source
```

O join de estoque usa:

```sql
LEFT JOIN stocks s
  ON s.product_id = oi.product_id
  AND s.unit_business_id = o.unit_business_id
```

## 9. Tabelas agregadas de facts

### 9.1. `daily_sales_facts`

Uma linha por dia e unidade de negócio.

```txt
id UUID PK
fact_date DATE NOT NULL
unit_business_id UUID NULL FK unit_businesses.id
integration_id UUID NULL FK integrations.id

orders_count INTEGER DEFAULT 0
items_quantity NUMERIC(14,4) DEFAULT 0
total_value NUMERIC(14,2) DEFAULT 0
total_freight NUMERIC(14,2) DEFAULT 0
average_freight NUMERIC(14,2) DEFAULT 0
average_ticket NUMERIC(14,2) DEFAULT 0

total_cost NUMERIC(14,2) DEFAULT 0
total_taxes NUMERIC(14,2) DEFAULT 0
total_fees NUMERIC(14,2) DEFAULT 0
contribution_value NUMERIC(14,2) DEFAULT 0
contribution_pct NUMERIC(8,2) DEFAULT 0
markup_pct NUMERIC(8,2) DEFAULT 0

last_updated_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

Constraint:

```txt
UNIQUE(fact_date, unit_business_id)
```

### 9.2. `daily_sales_state_facts`

Uma linha por dia, unidade e UF.

```txt
id UUID PK
fact_date DATE NOT NULL
unit_business_id UUID NULL FK unit_businesses.id
destination_uf VARCHAR(2) NOT NULL

orders_count INTEGER DEFAULT 0
items_quantity NUMERIC(14,4) DEFAULT 0
total_value NUMERIC(14,2) DEFAULT 0
total_freight NUMERIC(14,2) DEFAULT 0
average_freight NUMERIC(14,2) DEFAULT 0
average_ticket NUMERIC(14,2) DEFAULT 0

last_updated_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

Constraint:

```txt
UNIQUE(fact_date, unit_business_id, destination_uf)
```

### 9.3. `daily_sales_store_facts`

Uma linha por dia, unidade e loja (canal de venda).

```txt
id UUID PK
fact_date DATE NOT NULL
unit_business_id UUID NULL FK unit_businesses.id
store_id UUID NOT NULL FK stores.id

orders_count INTEGER DEFAULT 0
items_quantity NUMERIC(14,4) DEFAULT 0
total_value NUMERIC(14,2) DEFAULT 0
total_freight NUMERIC(14,2) DEFAULT 0
average_ticket NUMERIC(14,2) DEFAULT 0

total_cost NUMERIC(14,2) DEFAULT 0
piece_average_value NUMERIC(14,2) DEFAULT 0
markup_pct NUMERIC(8,2) DEFAULT 0

total_taxes NUMERIC(14,2) DEFAULT 0
total_fees NUMERIC(14,2) DEFAULT 0
contribution_value NUMERIC(14,2) DEFAULT 0
contribution_pct NUMERIC(8,2) DEFAULT 0

last_updated_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

Constraint:

```txt
UNIQUE(fact_date, unit_business_id, store_id)
```

Fórmulas:

```txt
average_ticket = total_value / orders_count
piece_average_value = total_value / items_quantity
markup_pct = (total_value - total_cost) / total_cost * 100
contribution_pct = contribution_value / total_value * 100
```

### 9.4. `daily_sales_product_facts`

Uma linha por dia, unidade e produto.

```txt
id UUID PK
fact_date DATE NOT NULL
unit_business_id UUID NULL FK unit_businesses.id
product_id UUID NULL FK products.id
sku VARCHAR(100) NOT NULL
description VARCHAR(255)

quantity NUMERIC(14,4) DEFAULT 0
total_cost NUMERIC(14,2) DEFAULT 0
total_value NUMERIC(14,2) DEFAULT 0
markup_pct NUMERIC(8,2) DEFAULT 0

last_updated_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

Constraint:

```txt
UNIQUE(fact_date, unit_business_id, sku)
```

Use `sku` como parte da chave porque pode haver pedido antigo sem `product_id` mapeado.

### 9.5. `daily_sales_status_facts`

Uma linha por dia, unidade e status (normalizado).

```txt
id UUID PK
fact_date DATE NOT NULL
unit_business_id UUID NULL FK unit_businesses.id
integration_id UUID NULL FK integrations.id
status_normalized VARCHAR(100) NOT NULL     -- valor normalizado via integration_mappings
status_display_name VARCHAR(100)            -- nome para exibição

orders_count INTEGER DEFAULT 0
total_value NUMERIC(14,2) DEFAULT 0

last_updated_at TIMESTAMP
created_at TIMESTAMP
updated_at TIMESTAMP
```

Constraint:

```txt
UNIQUE(fact_date, unit_business_id, integration_id, status_normalized)
```

Obs.: a chave inclui `integration_id` porque o mesmo status normalizado pode
vir de ERPs distintos, e convém distinguir na agregação quando relevante.

## 10. Campos de domínio auxiliares

### 10.1. `integration_order_status_mappings`

Tabela para normalizar status de pedido de qualquer ERP usando `integrations`
como âncora — sem campo `source_system`.

```txt
id UUID PK
integration_id UUID FK integrations.id    -- qual ERP/canal
external_status_id VARCHAR(50)            -- id/código no ERP
external_status_value VARCHAR(100)        -- valor bruto no ERP
normalized_status VARCHAR(100)            -- chave canônica interna
display_name VARCHAR(100)                 -- nome legível para UI
is_cancelled BOOLEAN DEFAULT FALSE
is_final BOOLEAN DEFAULT FALSE
created_at
updated_at
```

Constraint:

```txt
UNIQUE(integration_id, external_status_id)
```

O snapshot grava `status_snapshot` já normalizado. Se o nome do ERP mudar
depois, o histórico continua legível.

### 10.2. Tabela fiscal `invoice_fiscal_items`

Criada separada para não misturar com o fluxo operacional de `invoice_items`.

```txt
id UUID PK
invoice_id UUID FK invoices.id
product_id UUID NULL FK products.id
sku VARCHAR(100)
description VARCHAR(255)
quantity NUMERIC(14,4)
unit_price NUMERIC(14,4)
total_value NUMERIC(14,2)
ncm VARCHAR(20)
cest VARCHAR(20)
cfop VARCHAR(20)
gtin VARCHAR(20)
approx_tax_value NUMERIC(14,2)
icms_rate NUMERIC(8,4)
icms_value NUMERIC(14,2)
ipi_value NUMERIC(14,2)
pis_value NUMERIC(14,2)
cofins_value NUMERIC(14,2)
difal_value NUMERIC(14,2)
ibs_value NUMERIC(14,2)
cbs_value NUMERIC(14,2)
created_at
updated_at
```

Constraint:

```txt
UNIQUE(invoice_id, sku, cfop)
```

## 11. Fluxo do job incremental

```txt
src/modules/reports/sales-report/
├── sales-report.controller.ts
├── sales-report.queue.ts
├── sales-report.repository.ts
├── sales-report.routes.ts
├── sales-report.service.ts
└── sales-report.types.ts
```

Models para as novas tabelas:

```txt
src/modules/reports/sales-order-snapshot/
src/modules/reports/sales-order-item-snapshot/
src/modules/reports/daily-sales-fact/
src/modules/reports/daily-sales-state-fact/
src/modules/reports/daily-sales-store-fact/
src/modules/reports/daily-sales-product-fact/
src/modules/reports/daily-sales-status-fact/
```

### 11.1. Checkpoint

Usar `report_job_checkpoints` com:

```txt
job_name = 'sales_report'
```

Mesma regra do relatório operacional:

- capturar `jobStartTime` no começo;
- buscar `last_processed_at`;
- marcar running;
- processar;
- ao final salvar `last_processed_at = jobStartTime`;
- nunca usar `NOW()` no final como novo checkpoint.

### 11.2. Encontrar pedidos afetados

```txt
findAffectedOrderIds(lastProcessedAt)
```

Fontes de alteração:

```txt
orders.updated_at >= lastProcessedAt
order_items.updated_at >= lastProcessedAt
invoices.updated_at >= lastProcessedAt
invoice_fiscal_items.updated_at >= lastProcessedAt
products.updated_at >= lastProcessedAt
stocks.updated_at >= lastProcessedAt
```

Ponto importante sobre custo médio:

- Alteração de `stocks` não deve recalcular todos os pedidos antigos.
- O custo do item vendido deve ser congelado no snapshot do momento da venda.
- Backfill/reprocessamento de custo histórico deve ser comando separado e explícito.

### 11.3. Buscar chaves antigas antes do upsert

Igual ao `daily-operation-report.service.ts`:

```txt
previousFactKeys        = findAffectedFactKeys(orderIds)
previousStateKeys       = findAffectedStateFactKeys(orderIds)
previousStoreKeys       = findAffectedStoreFactKeys(orderIds)
previousProductKeys     = findAffectedProductFactKeys(orderIds)
previousStatusKeys      = findAffectedStatusFactKeys(orderIds)
```

Necessário porque um pedido pode mudar de: data, loja (canal), UF, status,
unidade de negócio ou produto mapeado.

### 11.4. Upsert de snapshots

Etapas:

1. Montar dados comerciais a partir de `orders` e `order_items`.
2. Associar produto por `product_id` ou `sku`.
3. Buscar custo médio em `stocks` com join por `product_id + unit_business_id`.
4. Buscar dados fiscais em `invoices` (via `orders.invoice_id`) e `invoice_fiscal_items`.
5. Normalizar status via `integration_order_status_mappings`.
6. Gravar `sales_order_item_snapshots`.
7. Agregar itens e gravar `sales_order_snapshots`.

### 11.5. Upsert das facts

```txt
upsertDailySalesFacts(keys)
upsertDailySalesStateFacts(keys)
upsertDailySalesStoreFacts(keys)
upsertDailySalesProductFacts(keys)
upsertDailySalesStatusFacts(keys)
```

Todas usam `ON CONFLICT DO UPDATE`.

## 12. Cálculos das visões

### 12.1. Por estado

Fonte: `daily_sales_state_facts`

```txt
Numero de pedidos  = orders_count
Qtde de volumes    = items_quantity
Valor total        = total_value
Frete medio        = total_freight / orders_count
Ticket medio       = total_value / orders_count
UF                 = XML dest/enderDest/UF ou invoices.destination_uf
```

### 12.2. Geral

Fonte: `daily_sales_facts`

```txt
Numero de pedidos  = orders_count
Qtde de volumes    = items_quantity
Valor total        = total_value
Frete              = total_freight
Ticket medio       = total_value / orders_count
```

### 12.3. Por produto

Fonte: `daily_sales_product_facts`

```txt
Quantidade = quantity
Custo      = total_cost
Valor      = total_value
Markup     = (total_value - total_cost) / total_cost * 100
```

### 12.4. Por loja

Fonte: `daily_sales_store_facts`

`store` aqui representa o canal de venda (Mercado Livre, Shopee, etc.),
conforme `stores.name`.

```txt
Qtde de pedidos     = orders_count
Ticket medio        = total_value / orders_count
Qtde de volumes     = items_quantity
Custo               = total_cost
Valor               = total_value
Frete               = total_freight
Valor peça          = total_value / items_quantity
Markup              = (total_value - total_cost) / total_cost * 100
Impostos            = total_taxes
Taxas               = total_fees
$ contribuição      = contribution_value
% contribuição      = contribution_value / total_value * 100
```

### 12.5. Por status

Fonte: `daily_sales_status_facts`

```txt
Qtde por status  = orders_count do status
Qtde total       = SUM(orders_count) do dia/unidade/integration
Valor do status  = total_value
```

Formato:

```txt
Atendido (1229/1428) valor total: 1701
```

## 13. API sugerida

```txt
GET /sales-report
```

Filtros:

```txt
dateFrom
dateTo
unitBusinessId
storeId          -- canal de venda
integrationId    -- ERP/fonte
state
productId
sku
statusNormalized
drillDown
```

Retorno sugerido:

```json
{
  "period": {
    "dateFrom": "2026-05-01",
    "dateTo": "2026-05-21"
  },
  "general": {},
  "byState": [],
  "byProduct": [],
  "byStore": [],
  "byStatus": [],
  "orders": []
}
```

`orders` só deve vir quando `drillDown = true`, buscando de `sales_order_snapshots`.

## 14. Sincronização dos ERPs

Cada ERP tem um adapter que converte o payload externo para o modelo canônico.
O adapter da Bling e o da Tecinco alimentam as mesmas tabelas.

### 14.1. Produto

Ao sincronizar produto de qualquer ERP:

1. Upsert em `products` com `integrations_id`, `id_system`, e campos canônicos.
2. Upsert em `suppliers` e criar/atualizar `products.supplier_id`.
3. Upsert em `product_supplier_maps` com código do fornecedor.
4. Atualizar `supplier_cost_price` e `supplier_purchase_price`.

### 14.2. Pedido

Ao sincronizar pedido:

1. Upsert em `orders` com `integrations_id`, `store_id`, `unit_business_id`,
   `id_order_system`, `number_order_system`, `number_order_channel`.
2. Upsert em `order_items`.
3. Normalizar status via `integration_order_status_mappings`.
4. Salvar totais, frete, desconto, despesas e taxas.
5. Se o ERP informar nota vinculada, buscar/criar `invoices` e preencher
   `orders.invoice_id`.

### 14.3. Nota fiscal e XML

Ao sincronizar nota:

1. Upsert em `invoices` com `integrations_id`, `unit_business_id`, `store_id`,
   `id_system` (id da nota no ERP), `xml_key`, totais fiscais, UF e cidade.
2. Baixar/parsear XML.
3. Salvar itens fiscais em `invoice_fiscal_items`.
4. Enfileirar reprocessamento do `sales_report` para os pedidos afetados.

## 15. Ordem recomendada de implementação

### Fase 1: base de dados

1. Migrations para campos faltantes em `products`, `orders`, `order_items`, `invoices`.
2. Criar tabela `invoice_fiscal_items`.
3. Criar tabela `integration_order_status_mappings`.
4. Criar tabelas de snapshots/facts de venda.
5. Criar constraints e índices.

### Fase 2: ingestão dos ERPs

1. Atualizar sincronização de produtos da Bling usando campos canônicos.
2. Atualizar sincronização de pedidos da Bling.
3. Atualizar sincronização de notas da Bling.
4. Implementar parser do XML da NF-e.
5. Quando a Tecinco entrar, criar apenas o adapter dela para alimentar o mesmo modelo.

### Fase 3: relatório

1. Criar módulo `sales-report`.
2. Implementar checkpoint `sales_report`.
3. Implementar `findAffectedOrderIds`.
4. Implementar `upsertSnapshots`.
5. Implementar upsert das facts.
6. Criar endpoint de consulta.
7. Adicionar fila recorrente com `BaseQueueService`.

### Fase 4: validação

1. Validar pedido real com NF-e e XML.
2. Conferir quantidade de volumes = soma dos itens.
3. Conferir custo médio por produto/unidade.
4. Conferir markup por produto.
5. Conferir contribuição por loja (canal de venda).
6. Conferir status e totais.

## 16. Exemplo com os dados informados

Produto:

```txt
Produto: Pneu 185/65R14 86H UltraContact Continental
SKU: 03151550000
Preço de venda NF-e: 449.90
Quantidade: 4
Fornecedor preço custo Bling: 335.605
```

Estoque interno:

```txt
stocks.total_price = 5369.68
stocks.quantity = 16
```

Custo médio:

```txt
5369.68 / 16 = 335.605
```

Item vendido:

```txt
Valor  = 449.90 * 4 = 1799.60
Custo  = 335.605 * 4 = 1342.42
Markup = ((1799.60 - 1342.42) / 1342.42) * 100 = 34.06%
```

Quantidade de volumes:

```txt
SUM(order_items.quantity) = 4
```

Mesmo que a Bling retorne `transporte.quantidadeVolumes = 0`, o relatório usa 4.

UF: `XML dest/enderDest/UF = SP` → pedido entra no agrupamento `SP`.

## 17. Riscos e decisões pendentes

### 17.1. Frete pago pela empresa

```txt
freight_charged = pedido.transporte.frete ou invoices.invoice_freight_value
freight_cost = pedido.taxas.custoFrete quando preenchido
freight_paid_by_company = regra por fretePorConta / canal (store) / filial (unit_business)
```

### 17.2. Taxas

Até existir fonte melhor:

```txt
total_fees = taxaComissao + SUM(item.comissao.valor)
```

Marketplace/payment podem precisar vir de configuração por `store` ou `integration`.

### 17.3. Impostos

- Para relatório gerencial: `total_taxes = vTotTrib`.
- Para contribuição fiscal real: `ICMS + IPI + PIS + COFINS + DIFAL + IBS + CBS`.
- Recomendação: salvar ambos; deixar claro qual métrica está sendo usada.

### 17.4. Pedidos sem NF-e

- Entram no relatório comercial usando dados do pedido.
- `has_invoice_data = false`.
- UF pode ficar nula até a NF-e chegar.
- Quando a NF-e/XML chegar, o job recalcula snapshots/facts.

### 17.5. Custo sem estoque

1. Usar `products.supplier_cost_price` como fallback.
2. Marcar `cost_source = PRODUCT_SUPPLIER_COST`.
3. Marcar `has_cost_fallback = true`.
4. Expor no drill-down para auditoria.

## 18. Checklist final

- Produto sincronizado com `integrations_id`, `supplier_id`, custo fornecedor, NCM, CEST, GTIN, marca e pesos.
- Estoque interno com `total_price` e `quantity` confiáveis; unicidade composta por `(product_id, unit_business_id)`.
- Pedido sincronizado com `integrations_id`, `store_id`, `unit_business_id`, `invoice_id`, totais, frete, desconto, taxas e itens.
- Status de pedido normalizado via `integration_order_status_mappings`.
- Item de pedido com `product_id` mapeado e quantidade.
- NF-e sincronizada com `invoices.destination_uf`, valor, frete, chave e XML.
- XML parseado e impostos salvos em `invoice_fiscal_items`.
- Snapshot de pedido com custo, impostos, taxas, frete e contribuição congelados.
- Snapshot de item com custo médio congelado e `cost_source` preenchido.
- Facts diárias por geral, estado, loja (canal), produto e status.
- Job incremental com checkpoint e `ON CONFLICT DO UPDATE`.
- Drill-down para auditar pedido/item quando algum número não bater.